// Servicio de correo. Agnóstico del transporte de negocio: solo envía.
//
// Estrategia de proveedor (cero configuración por defecto):
//   1. Si RESEND_API_KEY está seteado → Resend (entrega real a inboxes reales).
//   2. Si no y SMTP_HOST está seteado → SMTP (escalón temporal de prueba).
//   3. Si no → Ethereal: cuenta de prueba que nodemailer autocrea en runtime,
//      sin registro ni claves. El correo NO llega a un inbox real, pero se
//      obtiene una URL de preview donde se ve el email renderizado. Ideal para
//      probar el flujo en local sin que el usuario configure nada.
//
// `delivered` = true solo cuando Resend entregó de verdad. Ethereal reporta
// `delivered: false` + `previewUrl` (es preview, no entrega real).

import nodemailer, { type Transporter } from "nodemailer";
import { env, isProd } from "../env.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  /** true si se entregó a un inbox real (Resend). Ethereal → false. */
  delivered: boolean;
  /** URL de vista previa del email (solo Ethereal). */
  previewUrl?: string;
}

// Transporter de Ethereal cacheado: la cuenta de prueba se crea una sola vez.
let etherealTransport: Promise<Transporter> | null = null;
function getEtherealTransport(): Promise<Transporter> {
  if (!etherealTransport) {
    etherealTransport = nodemailer.createTestAccount().then((account) => {
      console.info(
        `\n📧 [mailer] Ethereal listo (cuenta de prueba autocreada, sin config).\n` +
          `   Login de buzón: https://ethereal.email/login  ·  user: ${account.user}  ·  pass: ${account.pass}\n` +
          `   (Los correos no llegan a inboxes reales; se ven por la URL de preview de cada envío.)\n`
      );
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    });
  }
  return etherealTransport;
}

/** Transporte SMTP temporal: falla rápido antes de agotar maxDuration de Vercel. */
let smtpTransport: Transporter | null = null;
function getSmtpTransport(): Transporter {
  if (smtpTransport) return smtpTransport;

  const hasCredentials = Boolean(env.SMTP_USER && env.SMTP_PASS);
  if ((env.SMTP_USER || env.SMTP_PASS) && !hasCredentials)
    console.warn("📧 [mailer:smtp] SMTP_USER y SMTP_PASS deben configurarse juntos; se intentará sin auth.");
  if (env.SMTP_USER && !env.MAIL_FROM.toLowerCase().includes(env.SMTP_USER.toLowerCase()))
    console.warn("📧 [mailer:smtp] MAIL_FROM debería usar la misma cuenta autenticada por SMTP.");

  smtpTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    ...(hasCredentials ? { auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! } } : {}),
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return smtpTransport;
}

/** Envía un email. Nunca lanza: en fallo devuelve delivered=false y loguea. */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  // Proveedor real (opt-in).
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`📧 [mailer] Resend respondió ${res.status}: ${body}`);
        return { delivered: false };
      }
      return { delivered: true };
    } catch (err) {
      console.error("📧 [mailer] Error enviando email vía Resend:", err);
      return { delivered: false };
    }
  }

  // Transporte temporal para comprobar entrega real antes de verificar el
  // dominio de Resend. Al configurar RESEND_API_KEY queda desactivado solo.
  if (env.SMTP_HOST) {
    try {
      await getSmtpTransport().sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      console.info(`📧 [mailer:smtp] Email aceptado por SMTP para: ${input.to}`);
      return { delivered: true };
    } catch (err) {
      console.error("📧 [mailer:smtp] Error enviando email vía SMTP:", err);
      return { delivered: false };
    }
  }

  // En producción no se cae a Ethereal: es un buzón de prueba y el SMTP
  // saliente suele estar bloqueado en serverless. La invitación se crea igual
  // y se comparte por su `acceptUrl`.
  if (isProd) {
    console.warn(
      "📧 [mailer] Sin RESEND_API_KEY en producción: no se envía correo. " +
        "Comparte el link de invitación manualmente o configura la key."
    );
    return { delivered: false };
  }

  // Fallback cero-config en dev: Ethereal.
  try {
    const transport = await getEtherealTransport();
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
    console.info(
      `\n📧 [mailer:ethereal] Email enviado a buzón de prueba.\n` +
        `   Para: ${input.to}\n` +
        `   Asunto: ${input.subject}\n` +
        `   👉 Ver email: ${previewUrl}\n`
    );
    return { delivered: false, previewUrl };
  } catch (err) {
    console.error("📧 [mailer] Error enviando email vía Ethereal:", err);
    console.info(
      `\n📧 [mailer:fallback] No se pudo enviar. Contenido:\n` +
        `   Para: ${input.to}\n   ${input.text.replace(/\n/g, "\n   ")}\n`
    );
    return { delivered: false };
  }
}

/** Correo de invitación a un workspace. */
export async function sendInvitationEmail(opts: {
  to: string;
  acceptUrl: string;
  workspaceName: string;
  inviterName: string;
  role: string;
}): Promise<SendResult> {
  const { to, acceptUrl, workspaceName, inviterName, role } = opts;
  const subject = `${inviterName} te invitó a ${workspaceName} en pemie.ai`;
  const text =
    `${inviterName} te invitó a unirte al workspace "${workspaceName}" en pemie.ai como ${role}.\n\n` +
    `Acepta la invitación abriendo este enlace:\n${acceptUrl}\n\n` +
    `Si no esperabas esta invitación, puedes ignorar este correo.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1f2e">
      <h2 style="font-size:20px;margin:0 0 12px">Te invitaron a <span style="color:#2563eb">${escapeHtml(
        workspaceName
      )}</span></h2>
      <p style="font-size:14px;line-height:1.6;color:#4b5563">
        <strong>${escapeHtml(inviterName)}</strong> te invitó a unirte al workspace
        <strong>${escapeHtml(workspaceName)}</strong> en pemie.ai como <strong>${escapeHtml(
          role
        )}</strong>.
      </p>
      <p style="margin:24px 0">
        <a href="${acceptUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
          Aceptar invitación
        </a>
      </p>
      <p style="font-size:12px;color:#9ca3af;line-height:1.6">
        O copia este enlace:<br><span style="word-break:break-all">${acceptUrl}</span>
      </p>
    </div>`;
  return sendEmail({ to, subject, html, text });
}

/** Correo al contributor cuando una Historia de Usuario pasa a su cargo. */
export async function sendStoryAssignedEmail(opts: {
  to: string;
  storyKey: string;
  storyTitle: string;
  projectName: string;
  assignerName: string;
  storyUrl: string;
  contentLite?: boolean;
}): Promise<SendResult> {
  const { to, storyKey, storyTitle, projectName, assignerName, storyUrl, contentLite = false } = opts;
  if (contentLite) {
    return sendEmail({
      to,
      subject: `Te asignaron una HU en ${projectName}`,
      text: `${assignerName} te asignó una Historia de Usuario en ${projectName}.\n\nInicia sesión para verla:\n${storyUrl}`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1f2e"><h2 style="font-size:20px;margin:0 0 12px">Te asignaron una Historia de Usuario</h2><p style="font-size:14px;line-height:1.6;color:#4b5563"><strong>${escapeHtml(assignerName)}</strong> te asignó una HU en <strong>${escapeHtml(projectName)}</strong>.</p><p style="margin:24px 0"><a href="${escapeHtml(storyUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Ver Historia de Usuario</a></p></div>`,
    });
  }
  const subject = `Te asignaron ${storyKey} · ${storyTitle} en ${projectName}`;
  const text =
    `${assignerName} te asignó la HU ${storyKey} · ${storyTitle} en ${projectName}.\n\n` +
    `Ver Historia de Usuario:\n${storyUrl}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1f2e">
      <h2 style="font-size:20px;margin:0 0 12px">Te asignaron una Historia de Usuario</h2>
      <p style="font-size:14px;line-height:1.6;color:#4b5563">
        <strong>${escapeHtml(assignerName)}</strong> te asignó <strong>${escapeHtml(storyKey)}</strong>
        · ${escapeHtml(storyTitle)} en <strong>${escapeHtml(projectName)}</strong>.
      </p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(storyUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
          Ver Historia de Usuario
        </a>
      </p>
      <p style="font-size:12px;color:#9ca3af;line-height:1.6">
        O copia este enlace:<br><span style="word-break:break-all">${escapeHtml(storyUrl)}</span>
      </p>
    </div>`;
  return sendEmail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
