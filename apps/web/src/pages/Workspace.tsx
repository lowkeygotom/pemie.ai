import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  API_SCOPES,
  buildAgentPrompt,
  type ApiScope,
  type Role,
} from "@pemie/shared";
import {
  api,
  analyticsFailureReason,
  ApiError,
  type Workspace as Ws,
  type ProjectSummary,
  type Member,
  type Invitation,
  type WorkspaceAgent,
  type RegisteredWorkspaceAgent,
  type ObservedWorkspaceAgent,
  type ApiKeyPublic,
} from "../lib/api.js";
import { track } from "../lib/analytics/index.js";
import { touchWorkspace } from "./workspaces/recents.js";
import { CapabilityReceipt, ConnectPanel } from "../components/ConnectPanel.js";
import { ScopePicker } from "../components/ScopePicker.js";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DangerZone,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  TrashIcon,
  type BadgeTone,
} from "../components/ui.js";

/** Roles asignables desde el selector de la fila (no hay flujo de transferencia de owner). */
const ASSIGNABLE_ROLES: Role[] = ["viewer", "member", "admin"];
const MCP_URL = `${window.location.origin}/mcp`;

export default function Workspace() {
  const { slug = "" } = useParams();
  const [ws, setWs] = useState<Ws | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadCore() {
    const [{ workspace }, { projects }] = await Promise.all([
      api.workspaces.get(slug),
      api.projects.list(slug),
    ]);
    setWs(workspace);
    setProjects(projects);
    touchWorkspace(slug);
  }

  useEffect(() => {
    loadCore().catch((e) =>
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el workspace")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (error)
    return (
      <Card>
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  if (!ws) return <WorkspaceSkeleton />;

  const canManage = ws.role === "owner" || ws.role === "admin";

  return (
    <div>
      <Link to="/app" className="mb-1 block text-body-sm text-ink-400 hover:text-ink-700">
        ← workspaces
      </Link>
      <PageHeader
        title={ws.name}
        actions={
          <div className="flex items-center gap-3">
            {canManage ? (
              <Link to={`/w/${slug}/settings`} className="text-body-sm text-blue-700 hover:underline">
                Ajustes
              </Link>
            ) : null}
            <Badge tone="neutral" mono>{ws.role}</Badge>
          </div>
        }
      />

      <div className="space-y-8">
        <ProjectsSection slug={slug} projects={projects} onChange={loadCore} />
        <TeamSection slug={slug} projects={projects} canManage={canManage} />
      </div>
    </div>
  );
}

/** Skeleton con la forma final de la página: cabecera, proyectos y equipo. */
function WorkspaceSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="mb-8 flex items-end justify-between gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-6 w-16 rounded-pill" />
      </div>
      <div className="space-y-8">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-36 rounded-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
        </section>
        <section>
          <Skeleton className="mb-4 h-6 w-24" />
          <Card>
            <SkeletonList rows={3} />
          </Card>
        </section>
      </div>
    </div>
  );
}

function ProjectsSection({
  slug,
  projects,
  onChange,
}: {
  slug: string;
  projects: ProjectSummary[];
  onChange: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.projects.create(slug, { name, key: key || undefined });
      track("project_created");
      setName("");
      setKey("");
      setCreating(false);
      await onChange();
    } catch (err) {
      track("project_created_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proyecto");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 text-ink-900">Proyectos</h2>
        <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
          Nuevo proyecto
        </Button>
      </div>

      {creating && (
        <Card className="mb-4">
          <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <Field label="Nombre">
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
            </div>
            <div className="w-28">
              <Field label="Key">
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase())}
                  placeholder="PRJ"
                  maxLength={6}
                />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear"}
            </Button>
          </form>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="Aún no hay proyectos"
          description="Crea el primero para empezar a rastrear commits e historias de usuario."
          action={
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              Crear proyecto
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={`/w/${slug}/p/${p.slug}`}>
              <Card interactive>
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-ink-900">{p.name}</h3>
                  <Badge tone="neutral" mono>{p.key}</Badge>
                </div>
                {p.description && (
                  <p className="mt-2 line-clamp-2 text-body-sm text-ink-500">{p.description}</p>
                )}
                <p className="mt-2 font-mono text-body-sm text-ink-400">
                  {p._count.repos} repos · {p._count.userStories} HUs
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Gestión del propio workspace: renombrar (admin/owner) y eliminar (solo owner).
 * Vive en el detalle y no en la lista porque son acciones sobre *este* workspace
 * y el borrado necesita espacio para una confirmación seria.
 */
export function SettingsSection({ ws, onRenamed }: { ws: Ws; onRenamed: (workspace: Ws) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canRename = trimmed.length >= 2 && trimmed !== ws.name && !saving;
  // Escribir el nombre exacto es la barrera contra el borrado por inercia.
  const canDelete = confirmation.trim() === ws.name && !deleting;

  async function onRename(e: React.FormEvent) {
    e.preventDefault();
    if (!canRename) return;
    setSaving(true);
    setRenameError(null);
    try {
      const { workspace } = await api.workspaces.update(ws.slug, trimmed);
      track("workspace_updated");
      onRenamed(workspace); // el estado de la página se refresca sin recargar
      setSaved(true);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "No se pudo renombrar el workspace");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.workspaces.remove(ws.slug);
      track("workspace_deleted");
      // La ruta actual deja de existir: se vuelve a la lista sin dejarla en el historial.
      navigate("/app", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo eliminar el workspace");
      setDeleting(false);
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-h3 text-ink-900">General</h2>
      <div className="space-y-4">
        <Card>
          <form onSubmit={onRename} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Field
                label="Nombre del workspace"
                hint={`La dirección no cambia: /w/${ws.slug} sigue funcionando.`}
              >
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                  minLength={2}
                  required
                />
              </Field>
            </div>
            <Button type="submit" disabled={!canRename}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </form>
          <div className="mt-2">
            <ErrorText>{renameError}</ErrorText>
            {saved && !renameError ? (
              <p className="text-body-sm text-ink-500">Nombre actualizado.</p>
            ) : null}
          </div>
        </Card>

        {ws.role === "owner" && (
          <DangerZone
            title="Eliminar workspace"
            description={
              <>
                <p>
                  Se borrarán de forma permanente los proyectos de este workspace y todo su
                  contenido: repositorios y commits, informes y notas, épicas e historias de
                  usuario, tableros, las API keys y el registro de auditoría. El equipo perderá
                  el acceso.
                </p>
                <p className="mt-2 font-semibold text-ink-800">Esta acción no se puede deshacer.</p>
              </>
            }
          >
            <form onSubmit={onDelete} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <Field label={`Escribe «${ws.name}» para confirmar`}>
                  <Input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={ws.name}
                    autoComplete="off"
                    aria-label={`Escribe ${ws.name} para confirmar la eliminación`}
                  />
                </Field>
              </div>
              <Button type="submit" variant="danger" disabled={!canDelete}>
                {deleting ? "Eliminando…" : "Eliminar workspace"}
              </Button>
            </form>
            <div className="mt-2">
              <ErrorText>{deleteError}</ErrorText>
            </div>
          </DangerZone>
        )}
      </div>
    </section>
  );
}

/** Papelera de fila: mismo gesto de borrado para personas y agentes. */
function IconTrashButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="grid h-8 w-8 flex-none place-items-center rounded-md text-ink-400 transition-colors hover:bg-red-100 hover:text-red-600 focus-visible:shadow-focus focus-visible:outline-none"
      aria-label={label}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

/**
 * De quién es el agente, al final de la línea de metadatos (PEM-35).
 *
 * Tres estados, ninguno accionable: no hay forma de reasignar dueño, así que
 * esto informa y no pide nada. Por eso va en texto plano y no en badge —los
 * badges de esta fila señalan cosas que se arreglan desde acá («sin API key»)—
 * y por eso «sin dueño registrado» no lleva icono ni tono de alerta: es un dato
 * que no existe, no un problema. Se repite en todos los agentes anteriores a
 * PEM-35 y tiene que poder ignorarse de un vistazo.
 *
 * `ownerIsMember` es una pregunta distinta de `owner != null`: hoy el producto
 * borra membresías, no usuarios, así que un dueño que se fue del equipo sigue
 * llegando entero en el payload.
 */
function AgentOwnerLabel({
  owner,
  ownerIsMember,
}: {
  owner: WorkspaceAgent["owner"];
  ownerIsMember: boolean;
}) {
  if (!owner) return <span className="text-caption text-ink-400">sin dueño registrado</span>;
  const label = owner.name ?? owner.email;
  return (
    <span
      className={`max-w-48 truncate text-caption ${ownerIsMember ? "text-ink-500" : "text-ink-400"}`}
      title={owner.email}
    >
      de {label}
      {ownerIsMember ? null : " · ya no está en el equipo"}
    </span>
  );
}

function invStatusTone(status: string): BadgeTone {
  if (status === "accepted") return "success";
  if (status === "expired") return "danger";
  return "warning";
}

function TeamSection({
  slug,
  projects,
  canManage,
}: {
  slug: string;
  projects: ProjectSummary[];
  canManage: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [roleErrors, setRoleErrors] = useState<Record<string, string>>({});
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [agentBusyId, setAgentBusyId] = useState<string | null>(null);
  const [agentConfirmId, setAgentConfirmId] = useState<string | null>(null);
  const [agentErrors, setAgentErrors] = useState<Record<string, string>>({});
  const [presenceBusyId, setPresenceBusyId] = useState<string | null>(null);
  const [presenceConfirmId, setPresenceConfirmId] = useState<string | null>(null);
  const [presenceErrors, setPresenceErrors] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("choose");
  // Regenerar key y ver la conexión solo aplican a agentes registrados: una
  // presencia observada no tiene agente al que colgarle una key nueva.
  const [regenerateAgent, setRegenerateAgent] = useState<RegisteredWorkspaceAgent | undefined>();
  const [connection, setConnection] = useState<{ agent: RegisteredWorkspaceAgent; key: ApiKeyPublic } | null>(null);
  const [teamLoad, setTeamLoad] = useState<{ status: "loading" } | { status: "ready" } | { status: "error"; message: string }>({ status: "loading" });

  function openAdd(mode: AddMode) {
    setRegenerateAgent(undefined);
    setAddMode(mode);
    setAddOpen(true);
  }

  function inviteLink(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  async function copyLink(id: string, token: string) {
    await navigator.clipboard?.writeText(inviteLink(token)).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1400);
  }

  async function load() {
    setTeamLoad({ status: "loading" });
    try {
      const [membersRes, agentsRes] = await Promise.all([
        api.workspaces.members(slug),
        api.agents.listWorkspace(slug),
      ]);
      setMembers(membersRes.members);
      setAgents(agentsRes.agents);
      if (canManage) {
        const [invRes, keysRes] = await Promise.all([
          api.workspaces.invitations(slug),
          api.apiKeys.list(slug),
        ]);
        setInvitations(invRes.invitations);
        setKeys(keysRes.apiKeys);
      }
      setTeamLoad({ status: "ready" });
    } catch (error) {
      setTeamLoad({ status: "error", message: error instanceof ApiError ? error.message : "No se pudo cargar el equipo" });
      throw error;
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, canManage]);

  async function invitePerson(email: string) {
    try {
      const res = await api.workspaces.invite(slug, email);
      // Nunca el email completo: si hace falta segmentar, dominio del correo.
      track("workspace_member_invited", { role: res.invitation.role, email_domain: email.split("@")[1] ?? "" });
      setLastInvite(res.invitation);
      await load();
      return res.invitation;
    } catch (err) {
      track("workspace_member_invited_failed", { reason: analyticsFailureReason(err) });
      throw err;
    }
  }

  async function onRevoke(id: string) {
    await api.workspaces
      .revokeInvite(slug, id)
      .then(() => track("workspace_invite_revoked"))
      .catch(() => {});
    await load();
  }

  async function onRoleChange(membershipId: string, role: Role) {
    setRoleBusyId(membershipId);
    setRoleErrors((prev) => ({ ...prev, [membershipId]: "" }));
    try {
      const { member } = await api.workspaces.updateMemberRole(slug, membershipId, role);
      // Reemplaza solo la fila afectada: evita un refetch completo de la lista.
      setMembers((prev) => prev.map((m) => (m.membershipId === membershipId ? member : m)));
    } catch (err) {
      setRoleErrors((prev) => ({
        ...prev,
        [membershipId]: err instanceof ApiError ? err.message : "No se pudo cambiar el rol",
      }));
    } finally {
      setRoleBusyId(null);
    }
  }

  async function onRemoveMember(membershipId: string) {
    setRemoveBusyId(membershipId);
    setRemoveErrors((prev) => ({ ...prev, [membershipId]: "" }));
    try {
      await api.workspaces.removeMember(slug, membershipId);
      setMembers((prev) => prev.filter((member) => member.membershipId !== membershipId));
      setRemoveConfirmId(null);
    } catch (err) {
      setRemoveErrors((prev) => ({
        ...prev,
        [membershipId]: err instanceof ApiError ? err.message : "No se pudo quitar al miembro",
      }));
    } finally {
      setRemoveBusyId(null);
    }
  }

  // Borrar el agente revoca sus API keys en el backend: hay que recargar la lista
  // de keys, no solo quitar la fila del agente del estado local.
  async function onDeleteAgent(agentId: string) {
    setAgentBusyId(agentId);
    setAgentErrors((prev) => ({ ...prev, [agentId]: "" }));
    try {
      await api.agents.remove(slug, agentId);
      track("agent_deleted");
      setAgentConfirmId(null);
      await load();
    } catch (err) {
      track("agent_deleted_failed", { reason: analyticsFailureReason(err) });
      setAgentErrors((prev) => ({
        ...prev,
        [agentId]: err instanceof ApiError ? err.message : "No se pudo eliminar el agente",
      }));
    } finally {
      setAgentBusyId(null);
    }
  }

  // El bloqueo no borra nada: la key vive en otro workspace y solo deja de
  // operar en éste. Por eso se recarga la lista en vez de quitar la fila —el
  // agente sigue en el roster, ahora marcado como bloqueado.
  async function onTogglePresenceBlock(agent: ObservedWorkspaceAgent) {
    const blocked = agent.blockedAt !== null;
    setPresenceBusyId(agent.id);
    setPresenceErrors((prev) => ({ ...prev, [agent.id]: "" }));
    try {
      if (blocked) await api.agents.unblockPresence(slug, agent.id);
      else await api.agents.blockPresence(slug, agent.id);
      track(blocked ? "agent_presence_unblocked" : "agent_presence_blocked", {
        scope_level: agent.scopeLevel,
      });
      setPresenceConfirmId(null);
      await load();
    } catch (err) {
      track(blocked ? "agent_presence_unblocked_failed" : "agent_presence_blocked_failed", {
        reason: analyticsFailureReason(err),
      });
      setPresenceErrors((prev) => ({
        ...prev,
        [agent.id]: err instanceof ApiError
          ? err.message
          : blocked
            ? "No se pudo desbloquear el agente"
            : "No se pudo bloquear el agente",
      }));
    } finally {
      setPresenceBusyId(null);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3 text-ink-900">Equipo</h2>
        {/* Una sola acción en la cabecera: el modal ya deja elegir persona o agente,
            y el hub sigue accesible desde cualquier proyecto. */}
        {canManage ? (
          <Button size="sm" onClick={() => openAdd("choose")}>
            Añadir al equipo
          </Button>
        ) : null}
      </div>

      <Card>
        {teamLoad.status === "loading" ? <SkeletonList rows={3} /> : null}
        {teamLoad.status === "error" ? (
          <Notice tone="danger">
            <p>No pudimos cargar el equipo.</p>
            <p className="mt-1">{teamLoad.message}</p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>Reintentar</Button>
          </Notice>
        ) : null}
        {teamLoad.status === "ready" && members.length === 0 && agents.length === 0 ? (
          <EmptyState
            title="Aún no hay nadie más en el equipo"
            description="Añade una persona por correo o crea un agente ligado a un proyecto."
            action={
              canManage ? (
                <Button size="sm" onClick={() => openAdd("choose")}>
                  Añadir al equipo
                </Button>
              ) : undefined
            }
          />
        ) : teamLoad.status === "ready" ? (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-body-sm font-semibold text-ink-600">Personas</h3>
              {members.length === 0 ? (
                <p className="text-body-sm text-ink-400">Todavía no hay personas invitadas.</p>
              ) : (
                <ul className="divide-y divide-line-100">
                  {members.map((m) => {
                    const editable = canManage && m.role !== "owner";
                    const confirmingRemove = removeConfirmId === m.membershipId;
                    const removeBusy = removeBusyId === m.membershipId;
                    return (
                      <li
                        key={m.membershipId}
                        className="-mx-6 flex items-center gap-3 px-6 py-2.5 first:pt-0 last:pb-0 hover:bg-surface-50"
                      >
                        <div className="grid h-8 w-8 flex-none place-items-center rounded-pill bg-surface-100 text-caption font-semibold text-ink-700">
                          {(m.user.name ?? m.user.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-sm font-medium text-ink-900">
                            {m.user.name ?? m.user.email}
                          </p>
                          <p className="truncate font-mono text-caption text-ink-400">{m.user.email}</p>
                        </div>
                        {editable ? (
                          <div className="flex flex-none flex-col items-end gap-1">
                            <Select
                              aria-label={`Rol de ${m.user.name ?? m.user.email}`}
                              value={m.role}
                              disabled={roleBusyId === m.membershipId}
                              onChange={(e) => onRoleChange(m.membershipId, e.target.value as Role)}
                              className="w-auto py-1.5 font-mono text-caption"
                            >
                              {ASSIGNABLE_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </Select>
                            {roleErrors[m.membershipId] ? (
                              <ErrorText>{roleErrors[m.membershipId]}</ErrorText>
                            ) : null}
                            <div className="flex items-center gap-1">
                              {confirmingRemove ? (
                                <>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={removeBusy}
                                    onClick={() => onRemoveMember(m.membershipId)}
                                  >
                                    {removeBusy ? "Quitando…" : "Confirmar"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={removeBusy}
                                    onClick={() => setRemoveConfirmId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </>
                              ) : (
                                <IconTrashButton
                                  label={`Quitar a ${m.user.name ?? m.user.email} del workspace`}
                                  onClick={() => setRemoveConfirmId(m.membershipId)}
                                />
                              )}
                            </div>
                            {removeErrors[m.membershipId] ? (
                              <ErrorText>{removeErrors[m.membershipId]}</ErrorText>
                            ) : null}
                          </div>
                        ) : (
                          <Badge tone="neutral" mono>{m.role}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-body-sm font-semibold text-ink-600">Agentes</h3>
              {agents.length === 0 ? (
                <p className="text-body-sm text-ink-400">Todavía no hay agentes trabajando aquí.</p>
              ) : (
                <ul className="divide-y divide-line-100">
                  {agents.map((agent) => {
                    // Presencia observada: una key de alcance amplio a la que se
                    // vio operar aquí sin estar registrada en este workspace. No
                    // hay agente detrás, así que no hay key que regenerar ni
                    // agente que borrar; solo cortarle el paso.
                    if (agent.source === "observed") {
                      const blocked = agent.blockedAt !== null;
                      const presenceBusy = presenceBusyId === agent.id;
                      const observedOwner = agent.owner;
                      const observedOwnerIsMember =
                        observedOwner !== null && members.some((m) => m.user.id === observedOwner.id);
                      return (
                        <li
                          key={`observed:${agent.id}`}
                          className="-mx-6 flex items-center gap-3 px-6 py-2.5 first:pt-0 last:pb-0 hover:bg-surface-50"
                        >
                          <div className="grid h-8 w-8 flex-none place-items-center rounded-md bg-surface-100 text-caption font-semibold text-ink-700">
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-body-sm font-medium ${blocked ? "text-ink-400" : "text-ink-900"}`}
                            >
                              {agent.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge tone="warning" mono>observado</Badge>
                              <Badge tone="neutral" mono>{agent.scopeLevel}</Badge>
                              {blocked ? <Badge tone="danger" dot>bloqueado</Badge> : null}
                              <AgentOwnerLabel
                                owner={observedOwner}
                                ownerIsMember={observedOwnerIsMember}
                              />
                              <span className="text-caption text-ink-400">
                                {agent.lastProject
                                  ? `visto en ${agent.lastProject.name}`
                                  : "sin proyecto registrado"}{" "}
                                · {new Date(agent.lastSeenAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          {canManage ? (
                            <div className="flex flex-none flex-col items-end gap-1">
                              {presenceConfirmId === agent.id ? (
                                <>
                                  <p className="text-caption text-ink-500">
                                    {blocked
                                      ? "Volverá a operar en este workspace."
                                      : "Dejará de operar aquí. Su key sigue viva en su propio workspace."}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant={blocked ? "primary" : "danger"}
                                      size="sm"
                                      disabled={presenceBusy}
                                      onClick={() => onTogglePresenceBlock(agent)}
                                    >
                                      {presenceBusy
                                        ? blocked
                                          ? "Desbloqueando…"
                                          : "Bloqueando…"
                                        : "Confirmar"}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={presenceBusy}
                                      onClick={() => setPresenceConfirmId(null)}
                                    >
                                      Cancelar
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setPresenceConfirmId(agent.id)}
                                >
                                  {blocked ? "Desbloquear" : "Bloquear"}
                                </Button>
                              )}
                              {presenceErrors[agent.id] ? (
                                <ErrorText>{presenceErrors[agent.id]}</ErrorText>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    }

                    const latestKey = keys
                      .filter((key) => key.agentId === agent.id)
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
                    const owner = agent.owner;
                    const ownerIsMember =
                      owner !== null && members.some((m) => m.user.id === owner.id);
                    return (
                      <li
                        key={`registered:${agent.id}`}
                        className="-mx-6 flex items-center gap-3 px-6 py-2.5 first:pt-0 last:pb-0 hover:bg-surface-50"
                      >
                        <div className="grid h-8 w-8 flex-none place-items-center rounded-md bg-blue-100 text-caption font-semibold text-blue-700">
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-sm font-medium text-ink-900">{agent.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge tone="success" mono>registrado</Badge>
                            <Badge tone="neutral" mono>{agent.project.slug}</Badge>
                            {canManage ? (
                              latestKey ? (
                                <>
                                  <Badge tone="brand" mono>{latestKey.scopeLevel}</Badge>
                                  {latestKey.lastUsedAt === null ? <Badge tone="warning" mono>nunca conectado</Badge> : null}
                                </>
                              ) : (
                                <Badge tone="warning" mono>sin API key</Badge>
                              )
                            ) : null}
                            <span className="font-mono text-caption text-ink-400">
                              {agent._count.apiKeys} {agent._count.apiKeys === 1 ? "key" : "keys"}
                            </span>
                            <AgentOwnerLabel owner={owner} ownerIsMember={ownerIsMember} />
                          </div>
                        </div>
                        {canManage ? (
                          <div className="flex flex-none flex-col items-end gap-1">
                            {agentConfirmId === agent.id ? (
                              <>
                                <p className="text-caption text-ink-500">
                                  {agent._count.apiKeys > 0
                                    ? `Se revocan sus ${agent._count.apiKeys} ${
                                        agent._count.apiKeys === 1 ? "key" : "keys"
                                      }.`
                                    : "Dejará de conectarse por MCP."}
                                </p>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={agentBusyId === agent.id}
                                    onClick={() => onDeleteAgent(agent.id)}
                                  >
                                    {agentBusyId === agent.id ? "Eliminando…" : "Confirmar"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={agentBusyId === agent.id}
                                    onClick={() => setAgentConfirmId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    if (latestKey) setConnection({ agent, key: latestKey });
                                    else {
                                      setRegenerateAgent(agent);
                                      setAddMode("agent");
                                      setAddOpen(true);
                                    }
                                  }}
                                >
                                  {latestKey ? "Conexión" : "Generar key"}
                                </Button>
                                <IconTrashButton
                                  label={`Eliminar el agente ${agent.name}`}
                                  onClick={() => setAgentConfirmId(agent.id)}
                                />
                              </div>
                            )}
                            {agentErrors[agent.id] ? (
                              <ErrorText>{agentErrors[agent.id]}</ErrorText>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      {canManage && (lastInvite || invitations.length > 0) ? (
        <Card className="mt-4">
          {lastInvite ? (
            <div className="rounded-md border border-blue-600 bg-blue-100 p-3">
              <p className="text-body-sm text-ink-700">
                {lastInvite.emailDelivered
                  ? `Invitación enviada por correo a ${lastInvite.email}.`
                  : lastInvite.emailPreviewUrl
                    ? `Invitación enviada al buzón de prueba (Ethereal). No llega al inbox real de ${lastInvite.email}, pero puedes ver el correo aquí:`
                    : `Invitación creada — comparte este enlace con ${lastInvite.email}:`}
              </p>
              {lastInvite.emailPreviewUrl ? (
                <a
                  href={lastInvite.emailPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-body-sm font-medium text-blue-600 underline"
                >
                  Ver correo enviado →
                </a>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 font-mono text-caption text-ink-700">
                  {inviteLink(lastInvite.token)}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copyLink(lastInvite.id, lastInvite.token)}>
                  {copiedId === lastInvite.id ? "copiado" : "copiar link"}
                </Button>
              </div>
            </div>
          ) : null}

          {invitations.length > 0 ? (
            <ul className={`${lastInvite ? "mt-4 border-t border-line-100 pt-3" : ""} divide-y divide-line-100`}>
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink-900">{inv.email}</span>
                  <Badge tone={invStatusTone(inv.status)} dot>{inv.status}</Badge>
                  <Badge tone="neutral" mono>{inv.role}</Badge>
                  {inv.status === "pending" ? (
                    <Button variant="secondary" size="sm" onClick={() => copyLink(inv.id, inv.token)}>
                      {copiedId === inv.id ? "copiado" : "copiar link"}
                    </Button>
                  ) : null}
                  <Button variant="danger" size="sm" onClick={() => onRevoke(inv.id)}>revocar</Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {canManage && addOpen ? (
        <AddTeamModal
          slug={slug}
          projects={projects}
          initialMode={addMode}
          onClose={() => setAddOpen(false)}
          onInvite={invitePerson}
          onChanged={load}
          existingAgent={regenerateAgent}
        />
      ) : null}
      {canManage && connection ? (
        <Modal title={`Conexión · ${connection.agent.name}`} onClose={() => setConnection(null)} size="xl">
          <div className="space-y-4">
            <Notice tone="info">La key no se puede recuperar: solo guardamos su hash. Este prompt usa su prefijo real.</Notice>
            <ConnectPanel
              showKey={false}
              apiKey={`${connection.key.prefix}…`}
              mcpUrl={MCP_URL}
              prompt={buildAgentPrompt({
                workspaceSlug: slug,
                target: { scopeLevel: "project", project: { slug: connection.agent.project.slug, id: connection.agent.project.id } },
                scopes: connection.key.scopes as ApiScope[],
                keyRef: { kind: "prefix", prefix: connection.key.prefix },
                mcpUrl: MCP_URL,
              })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConnection(null)}>Cerrar</Button>
              <Button onClick={() => {
                setRegenerateAgent(connection.agent);
                setConnection(null);
                setAddMode("agent");
                setAddOpen(true);
              }}>Generar nueva key</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

type AddMode = "choose" | "person" | "agent" | "credential";

function AddTeamModal({
  slug,
  projects,
  initialMode,
  onClose,
  onInvite,
  onChanged,
  existingAgent,
}: {
  slug: string;
  projects: ProjectSummary[];
  initialMode: AddMode;
  onClose: () => void;
  onInvite: (email: string) => Promise<Invitation>;
  onChanged: () => Promise<void>;
  existingAgent?: RegisteredWorkspaceAgent;
}) {
  const [mode, setMode] = useState<AddMode>(initialMode);
  const [email, setEmail] = useState("");
  const [agentProjectSlug, setAgentProjectSlug] = useState(existingAgent?.project.slug ?? projects[0]?.slug ?? "");
  const [agentName, setAgentName] = useState(existingAgent?.name ?? "");
  const [scopes, setScopes] = useState<string[]>([...API_SCOPES]);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(existingAgent?.id ?? null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const selectedProject = projects.find((project) => project.slug === agentProjectSlug);
  const isCredential = mode === "credential" && Boolean(newKey);
  const isExistingAgent = Boolean(existingAgent);
  const hasReadScope = scopes.some((scope) => scope.endsWith(":read"));
  const canCreateAgent = Boolean(
    selectedProject && agentName.trim().length >= 2 && scopes.length > 0 && hasReadScope && !busy
  );

  const capabilityPreview = useMemo(
    () => selectedProject
      ? buildAgentPrompt({
          workspaceSlug: slug,
          target: { scopeLevel: "project", project: { slug: selectedProject.slug, id: selectedProject.id } },
          scopes: scopes as ApiScope[],
          keyRef: { kind: "placeholder", label: "<API_KEY_RECIÉN_CREADA>" },
          mcpUrl: MCP_URL,
        })
      : null,
    [selectedProject, scopes, slug]
  );

  useEffect(() => {
    if (!isCredential || confirmedSaved) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isCredential, confirmedSaved]);

  async function submitPerson(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onInvite(email);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo invitar");
    } finally {
      setBusy(false);
    }
  }

  async function createOrRetryAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreateAgent) return;
    setBusy(true);
    setError(null);
    setKeyError(null);

    let agentId = createdAgentId;
    try {
      if (!agentId) {
        const result = await api.agents.create(slug, agentProjectSlug, agentName.trim());
        agentId = result.agent.id;
        setCreatedAgentId(agentId);
        track("agent_registered");
        try {
          await onChanged();
        } catch {
          // La creación fue exitosa; el siguiente load recuperará el agente.
        }
      }

      try {
        const result = await api.apiKeys.create(slug, {
          name: agentName.trim(),
          scopeLevel: "project",
          projectId: selectedProject?.id,
          agentId,
          scopes,
        });
        track("api_key_created", { scope_level: "project" });
        setNewKey(result.key);
        setConfirmedSaved(false);
        setMode("credential");
        try {
          await onChanged();
        } catch {
          // La key ya existe y se muestra aquí; el listado se actualizará al cerrar.
        }
      } catch (err) {
        track("api_key_created_failed", { reason: analyticsFailureReason(err) });
        try {
          await onChanged();
        } catch {
          // El mensaje mantiene el estado parcial aunque el refresco falle.
        }
        setKeyError(err instanceof ApiError ? err.message : "No se pudo crear la API key");
      }
    } catch (err) {
      track("agent_registered_failed", { reason: analyticsFailureReason(err) });
      setError(err instanceof ApiError ? err.message : "No se pudo crear el agente");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isCredential ? "3 · Conectar" : existingAgent ? `Generar key · ${existingAgent.name}` : "Añadir al equipo"}
      onClose={onClose}
      size={mode === "credential" ? "xl" : mode === "agent" ? "lg" : undefined}
      dismissible={!isCredential}
    >
      {mode === "choose" ? (
        <div>
          <p className="text-body-sm text-ink-600">Elige qué tipo de integrante quieres añadir.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("person")}
              className="rounded-lg border border-line-200 bg-surface-0 p-4 text-left transition-colors hover:border-blue-600 hover:bg-blue-100 focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="text-body font-semibold text-ink-900">Persona</span>
              <span className="mt-1 block text-body-sm text-ink-500">Invítala por correo; acepta cuando quiera.</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("agent")}
              className="rounded-lg border border-line-200 bg-surface-0 p-4 text-left transition-colors hover:border-blue-600 hover:bg-blue-100 focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="text-body font-semibold text-ink-900">Agente</span>
              <span className="mt-1 block text-body-sm text-ink-500">Vive en un proyecto y recibe una API key.</span>
            </button>
          </div>
        </div>
      ) : null}

      {mode === "person" ? (
        <form onSubmit={submitPerson} className="space-y-4">
          <Field label="Correo de la persona" hint="Le enviaremos una invitación para unirse al workspace.">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@empresa.com"
              required
              autoFocus
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode("choose")}>Atrás</Button>
            <Button type="submit" disabled={busy}>{busy ? "Invitando…" : "Enviar invitación"}</Button>
          </div>
        </form>
      ) : null}

      {mode === "agent" ? (
        projects.length === 0 ? (
          <EmptyState
            title="Crea un proyecto primero"
            description="Cada agente pertenece a un proyecto. Cierra este diálogo, crea uno y vuelve a intentarlo."
            action={<Button variant="secondary" size="sm" onClick={onClose}>Cerrar</Button>}
          />
        ) : (
          <form onSubmit={createOrRetryAgent} className="space-y-4">
            {createdAgentId && !isExistingAgent ? (
              <Notice tone="success">
                <p className="font-semibold">Agente creado</p>
                <p className="mt-1">La key se puede reintentar sin crear otro agente.</p>
              </Notice>
            ) : null}
            {keyError ? (
              <Notice tone="danger">
                <p>El agente quedó creado, pero la primera API key falló.</p>
                <p className="mt-1">{keyError} Reintentar solo crea la key pendiente.</p>
              </Notice>
            ) : null}
            <Field label="Proyecto" hint="El agente quedará asociado a este proyecto.">
              <Select
                value={agentProjectSlug}
                onChange={(e) => setAgentProjectSlug(e.target.value)}
                disabled={Boolean(createdAgentId) || busy}
                required
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.slug}>{project.name}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Nombre del agente"
              hint={createdAgentId ? "El nombre queda fijo para poder reintentar la misma key." : "También será el nombre de la primera API key."}
            >
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Ej: hermes"
                minLength={2}
                required
                disabled={Boolean(createdAgentId) || busy}
                autoFocus
              />
            </Field>
            <Field label="Alcance" hint="Los agentes recién creados empiezan ligados a su proyecto.">
              <Badge tone="brand" mono>project</Badge>
            </Field>
            <Field label="Permisos de la primera API key" hint="Elige un preset o personaliza por dominio. Escritura añade su lectura correspondiente.">
              <ScopePicker value={scopes as ApiScope[]} onChange={(next) => setScopes(next)} />
            </Field>
            {capabilityPreview ? <CapabilityReceipt prompt={capabilityPreview} /> : null}
            {!hasReadScope ? <ErrorText>Elige al menos un permiso de lectura: sin ninguno el agente no puede descubrir nada.</ErrorText> : null}
            <ErrorText>{error}</ErrorText>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setMode("choose")} disabled={busy || Boolean(createdAgentId)}>
                Atrás
              </Button>
              <Button type="submit" disabled={!canCreateAgent}>
                {busy ? "Guardando…" : isExistingAgent ? "Generar nueva API key" : createdAgentId ? "Reintentar API key" : "Crear agente y API key"}
              </Button>
            </div>
          </form>
        )
      ) : null}

      {mode === "credential" && newKey ? (
        <div className="space-y-4">
          <ConnectPanel
            apiKey={newKey}
            mcpUrl={MCP_URL}
            prompt={buildAgentPrompt({
              workspaceSlug: slug,
              target: { scopeLevel: "project", project: { slug: selectedProject!.slug, id: selectedProject!.id } },
              scopes: scopes as ApiScope[],
              keyRef: { kind: "plaintext", key: newKey },
              mcpUrl: MCP_URL,
            })}
            onCopy={() => setConfirmedSaved(true)}
          />
          <Checkbox checked={confirmedSaved} onChange={setConfirmedSaved}>
            Guardé la key — o el prompt, que la incluye.
          </Checkbox>
          <Button type="button" className="w-full" disabled={!confirmedSaved} onClick={onClose}>
            Ya la guardé, cerrar
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
