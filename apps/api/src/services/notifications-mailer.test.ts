// La variante `contentLite: true` del correo de asignación (PEM-42) necesita
// interceptar `sendStoryAssignedEmail` (./mailer.js): sin eso, `notifyStoryAssigned`
// termina llamando a `sendEmail` real, que cae al transporte Ethereal y hace una
// llamada de red real en cada corrida de test.
//
// Este caso vive en su propio archivo, separado de notifications.test.ts, por una
// razón técnica confirmada con un spike (`node --experimental-test-module-mocks`,
// Node v26 instalado en este entorno): `t.mock.module()` reemplaza la resolución
// de un *specifier* para imports que ocurran DESPUÉS de crear el mock. Los
// bindings de un `import` estático de ESM se ligan en el momento en que el
// módulo se carga — y notifications.test.ts ya hace `import { notifyStoryAssigned,
// ... } from "./notifications.js"` al tope del archivo, lo que carga (y liga)
// mailer.js real antes de que corra ningún test(). Mockear mailer.js dentro de un
// test() de ese archivo, incluso con un `import()` dinámico posterior del mismo
// specifier, sigue devolviendo la instancia de módulo ya cacheada y ligada al
// mailer real (verificado empíricamente: el mock no tiene efecto ahí).
//
// El test runner de Node aísla cada archivo *.test.ts en su propio proceso, así
// que alcanza con que ESTE archivo no tenga, al tope, ningún import (estático o
// dinámico) de notifications.js/mailer.js antes de crear el mock: se mockea
// primero, y recién ahí se importa notifications.js dinámicamente dentro del test.

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../db.js";

function stubDelegate(t: TestContext, model: string, double: Record<string, unknown>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  Object.defineProperty(client, model, { value: double, configurable: true, writable: true });
  t.after(() => Object.defineProperty(client, model, { value: original, configurable: true, writable: true }));
}

test("una asignación a un contributor sin membership en el workspace manda el correo con contentLite: true", async (t) => {
  stubDelegate(t, "contributor", {
    findUnique: async () => ({
      id: "contributor-1",
      githubLogin: "externo",
      userId: null,
      email: "externo@example.com",
      project: { workspaceId: "workspace-1" },
    }),
  });
  // isMember: false porque no hay membership para este usuario en el workspace.
  stubDelegate(t, "user", {
    findUnique: async () => ({ id: "user-externo" }),
    findMany: async () => [], // resolveActorNames: sin ids que resolver, batch vacío.
  });
  stubDelegate(t, "membership", { findUnique: async () => null });
  stubDelegate(t, "agent", { findMany: async () => [] });
  stubDelegate(t, "apiKey", { findMany: async () => [] });
  stubDelegate(t, "userStory", {
    findUnique: async () => ({
      key: "PEM-38",
      title: "Notificar asignación",
      project: { name: "pemie", slug: "pemie", workspace: { slug: "acme" } },
    }),
  });
  stubDelegate(t, "assignmentNotification", {
    findUnique: async () => null,
    upsert: async () => ({}),
  });

  const calls: Array<Record<string, unknown>> = [];
  const mock = t.mock.module("./mailer.js", {
    // `namedExports` (no `exports`, más nuevo): el runtime instalado (Node v26)
    // soporta ambos —`exports` es el nombre recomendado pero @types/node ^22
    // (el que fija este repo) todavía no lo declara. `namedExports` sigue
    // funcionando igual, solo con un warning de deprecación en stderr; se
    // prioriza no tocar la versión de @types/node por esto.
    namedExports: {
      sendStoryAssignedEmail: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return { delivered: false, previewUrl: "https://ethereal.email/message/mock" };
      },
    },
  });
  t.after(() => mock.restore());

  const { notifyStoryAssigned } = await import("./notifications.js");

  const result = await notifyStoryAssigned({
    storyId: "story-1",
    assigneeId: "contributor-1",
    actor: { actorType: "agent", actorId: null },
  });

  assert.equal(calls.length, 1, "sendStoryAssignedEmail se llama una sola vez, no cae al mailer real");
  const sentWith = calls[0]!;
  assert.equal(sentWith.contentLite, true, "sin membership => contentLite: true");
  assert.equal(sentWith.storyKey, "PEM-38", "sendStoryAssignedEmail decide qué renderizar; los datos igual se le pasan");
  assert.equal(sentWith.storyTitle, "Notificar asignación");
  assert.equal(result.notified, true);
});
