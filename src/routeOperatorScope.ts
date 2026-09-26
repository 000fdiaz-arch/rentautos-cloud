const ROUTE_BY_OPERATOR_EMAIL: Record<string, string> = {
  "delta1@auth.rentautos.local": "PTY",
  "delta2@auth.rentautos.local": "WC"
};

export function routeFilterForOperatorEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  return ROUTE_BY_OPERATOR_EMAIL[email.trim().toLowerCase()];
}
