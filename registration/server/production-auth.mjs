const organiserPermissions = Object.freeze(["read", "manage", "race_number", "export_private", "erase", "audit"]);

export function authorize(actor, permission) {
  if (actor?.authenticated && actor.actorType === "scheduler" && actor.role === "production_scheduler") return permission === "manage";
  return Boolean(actor?.authenticated && actor.role === "organiser" && organiserPermissions.includes(permission));
}

export function staticWebAppActor(headers = {}) {
  const encoded = headers["x-ms-client-principal"];
  if (!encoded) return { authenticated: false, role: null, actorType: "anonymous" };
  try {
    const principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const roles = Array.isArray(principal.userRoles) ? principal.userRoles.map((role) => String(role).toLowerCase()) : [];
    if (!roles.includes("authenticated") || !roles.includes("organiser")) {
      return { authenticated: roles.includes("authenticated"), role: null, actorType: "entra_user", id: principal.userId ?? null };
    }
    return { authenticated: true, role: "organiser", actorType: "entra_organiser", id: principal.userId ?? null };
  } catch {
    return { authenticated: false, role: null, actorType: "anonymous" };
  }
}

export function actorForRequest({ headers = {} }) {
  return staticWebAppActor(headers);
}

export const productionAuthProposal = Object.freeze({ provider: "Microsoft Entra ID through Azure Static Web Apps", role: "organiser", customPasswordStorage: false });
