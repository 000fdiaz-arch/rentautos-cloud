import type { ReactNode } from "react";
import type { AppPage } from "./appRoutes";

type IconName = AppPage | "expand" | "collapse" | "more" | "sign-out";

const shapes: Record<IconName, ReactNode> = {
  leads: <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 21v-2a6 6 0 0 1 12 0v2M19 7v6m-3-3h6" />
  </>,
  control_units: <>
    <path d="m5 8 1.5-4h11L19 8M4 17v3m16-3v3M3 11a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6H3Z" />
    <path d="M6.5 12h2m7 0h2M9 17h6" />
  </>,
  clients: <>
    <circle cx="9" cy="7" r="3" />
    <path d="M2 21v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6m3 5a5 5 0 0 1 3 4v2" />
  </>,
  payments: <>
    <path d="M20 8V5a2 2 0 0 0-2-2L5 6M21 11V8H5a2 2 0 0 1 0-4M3 6v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
    <path d="M21 11h-4a2.5 2.5 0 0 0 0 5h4Z" />
    <path d="M17 13.5h.01" />
  </>,
  receivables: <>
    <path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <rect x="9" y="2" width="6" height="5" rx="1" />
    <path d="M8 12h.01M11 12h5M8 17h.01M11 17h5" />
  </>,
  receivables_v2: <>
    <path d="M8 3H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
    <rect x="8" y="1" width="8" height="5" rx="1.5" />
    <path d="m8 13 3 3 5-6" />
  </>,
  route_search: <>
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,
  incidents: <>
    <path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4m0 4h.01" />
  </>,
  settings: <>
    <path d="M9.5 2h5l.5 2.5 2 1.2 2.4-.8 2.5 4.2-1.9 1.7v2.4l1.9 1.7-2.5 4.2-2.4-.8-2 1.2-.5 2.5h-5L9 19.5l-2-1.2-2.4.8-2.5-4.2L4 13.2v-2.4L2.1 9.1l2.5-4.2 2.4.8L9 4.5Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  expand: <path d="m9 6 6 6-6 6" />,
  collapse: <path d="m15 6-6 6 6 6" />,
  more: <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
  "sign-out": <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 4 5 5-5 5M9 12h12" />
  </>
};

export function NavigationIcon({ name }: { name: IconName }) {
  return <svg className="app-navigation-icon" xmlns="http://www.w3.org/2000/svg"
    width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
