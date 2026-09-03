export const ROLE_PERMISSIONS = Object.freeze({
  Organiser: ["read", "manage", "race_number", "export_private", "erase", "audit"],
  administrator: ["read", "manage", "race_number", "export_private", "erase", "audit"],
  registration_manager: ["read", "manage", "race_number", "export_private", "audit"],
  race_day_volunteer: ["read", "race_number"],
  read_only_viewer: ["read"]
});

export function authorize(actor, permission) {
  return Boolean(actor?.authenticated && ROLE_PERMISSIONS[actor.role]?.includes(permission));
}

export function developmentActor({ environment, hostname, headers = {} }) {
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  const enabled = String(headers["x-development-organiser"] ?? "").toLowerCase() === "enabled";
  if (environment !== "local" || !loopback || !enabled) return { authenticated: false, role: null, actorType: "anonymous" };
  const requestedRole = String(headers["x-development-role"] ?? "administrator");
  const role = ROLE_PERMISSIONS[requestedRole] ? requestedRole : "read_only_viewer";
  return { authenticated: true, role, actorType: "development_organiser", id: `local:${role}` };
}

export function staticWebAppActor(headers = {}) {
  const encoded = headers["x-ms-client-principal"];
  if (!encoded) return { authenticated: false, role: null, actorType: "anonymous" };
  try {
    const principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
    if (!roles.includes("authenticated") || !roles.includes("Organiser")) {
      return { authenticated: roles.includes("authenticated"), role: null, actorType: "entra_user", id: principal.userId ?? null };
    }
    return { authenticated: true, role: "Organiser", actorType: "entra_organiser", id: principal.userId ?? null };
  } catch {
    return { authenticated: false, role: null, actorType: "anonymous" };
  }
}

export function actorForRequest({ environment, hostname, headers = {} }) {
  return environment === "local"
    ? developmentActor({ environment, hostname, headers })
    : staticWebAppActor(headers);
}

export const productionAuthProposal = Object.freeze({ provider: "Microsoft Entra ID through Azure Static Web Apps", customPasswordStorage: false });
