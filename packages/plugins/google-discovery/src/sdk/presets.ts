export interface GoogleDiscoveryPreset {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly url: string;
  readonly icon?: string;
}

const gd = (service: string, version: string) =>
  `https://www.googleapis.com/discovery/v1/apis/${service}/${version}/rest`;

export const googleDiscoveryPresets: readonly GoogleDiscoveryPreset[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    summary: "Calendars, events, ACLs, and scheduling.",
    url: gd("calendar", "v3"),
    icon: "https://fonts.gstatic.com/s/i/productlogos/calendar_2020q4/v8/192px.svg",
  },
  {
    id: "google-gmail",
    name: "Gmail",
    summary: "Messages, threads, labels, and drafts.",
    url: gd("gmail", "v1"),
    icon: "https://fonts.gstatic.com/s/i/productlogos/gmail_2020q4/v8/web-96dp/logo_gmail_2020q4_color_2x_web_96dp.png",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    summary: "Spreadsheets, values, ranges, and formatting.",
    url: gd("sheets", "v4"),
    icon: "https://fonts.gstatic.com/s/i/productlogos/sheets_2020q4/v8/192px.svg",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    summary: "Files, folders, permissions, and shared drives.",
    url: gd("drive", "v3"),
    icon: "https://fonts.gstatic.com/s/i/productlogos/drive_2020q4/v8/192px.svg",
  },
  {
    id: "google-docs",
    name: "Google Docs",
    summary: "Documents, structural edits, and formatting.",
    url: gd("docs", "v1"),
    icon: "https://fonts.gstatic.com/s/i/productlogos/docs_2020q4/v12/192px.svg",
  },
];
