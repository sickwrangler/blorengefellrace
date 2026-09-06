import fs from "node:fs";

const file = "staticwebapp.config.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.routes.unshift(
  { route: "/registration/dashboard.html", allowedRoles: ["Organiser"] },
  { route: "/api/v2/organiser/*", allowedRoles: ["Organiser"] }
);
config.responseOverrides["401"] = {
  redirect: "/.auth/login/aad?post_login_redirect_uri=.referrer",
  statusCode: 302
};
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log("Applied organiser authentication routes for the isolated development deployment.");
