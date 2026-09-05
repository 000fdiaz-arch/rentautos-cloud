import React from "react";
import { createRoot } from "react-dom/client";
import AppShell from "../../src/AppShell";
import { ROLE_SCREEN_PERMISSIONS } from "../../src/auth/permissions";
import "../../src/styles.css";

const permissions = Object.fromEntries(Object.keys(ROLE_SCREEN_PERMISSIONS.admin).map(key =>
  [key, { view: key === "leads" || key === "clients", edit: false }]
)) as typeof ROLE_SCREEN_PERMISSIONS.admin;

createRoot(document.getElementById("root")!).render(<AppShell
  userId="11111111-1111-4111-8111-111111111111"
  permissions={permissions}
/>);
