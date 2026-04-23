import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  type ChangeEvent,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import "./App.css";

type PageKey =
  | "dashboard"
  | "tickets"
  | "annual"
  | "audits"
  | "compare"
  | "subscriptions"
  | "collab"
  | "settings"
  | "version"
  | "admin";

type Ticket = {
  date: string;
  description: string;
  category: string;
  amount: number;
  sent: boolean;
  sortIndex?: number;
  sheetRow?: number;
  blockIndex?: number;
};

type TicketMonthSummary = {
  accountBalance: number | null;
  currentRemaining: number | null;
  theoreticalRemaining: number | null;
  unexpectedSpendTotal: number | null;
  source: "sheet" | "fallback";
};

type MonthOption = {
  value: string;
  label: string;
  apiName: string;
};

type NewTicketForm = {
  date: string;
  amount: string;
  description: string;
  category: string;
};

type CsvImportDraft = {
  id: string;
  sourceRow: number;
  sourceType: string;
  include: boolean;
  note: string;
  date: string;
  amount: string;
  description: string;
  category: string;
  error: string;
};

type CsvImportSummaryItem = {
  label: string;
  count: number;
};

type CsvImportSummary = {
  totalRows: number;
  hardSkippedRows: number;
  ignoredByReason: CsvImportSummaryItem[];
};

type CsvImportSessionParticipant = {
  id: string;
  name: string;
  color: string;
  lastSeen: number;
};

type SharedCsvImportSession = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  submittingById: string;
  submittingByName: string;
  fileName: string;
  targetMonth: string;
  summary: CsvImportSummary;
  drafts: CsvImportDraft[];
  participants: CsvImportSessionParticipant[];
  status: string;
  startedAt: number;
  updatedAt: number;
};

type CsvImportParsedRow = {
  sourceRow: number;
  sourceType: string;
  dateStart: string;
  month: string;
  description: string;
  signedAmount: number;
};

type ReimbursementFormLine = {
  category: string;
  amount: string;
};

type ReimbursementDetailsEntry = {
  row: number;
  category: string;
  amount: number;
};

type DashboardSubscription = {
  id: string;
  label: string;
  amount: number;
};

type ReimbursementDetails = {
  entries: ReimbursementDetailsEntry[];
  ceTotal: number;
  medecinTotal: number;
  total: number;
};

type ReimbursementRemoteHistoryAction = {
  kind: "delete";
  month: string;
  entry: ReimbursementDetailsEntry;
};

type TicketStatusFilter = "all" | "sent" | "pending";
type TicketSortMode =
  | "date_desc"
  | "date_asc"
  | "amount_desc"
  | "amount_asc"
  | "description_asc";

type CollabIdentity = {
  id: string;
  name: string;
  color: string;
  seed: string;
};

type TicketBudgetLine = {
  key: string;
  label: string;
  planned: number;
  matchCategories: string[];
};

type TicketBudgetComputedLine = TicketBudgetLine & {
  actual: number;
  difference: number;
};

type AccountPagePermissions = {
  dashboard: boolean;
  tickets: boolean;
  annual: boolean;
  audits: boolean;
  compare: boolean;
  subscriptions: boolean;
  collab: boolean;
  settings: boolean;
  version: boolean;
  admin: boolean;
};

const accountPagePermissionKeys: (keyof AccountPagePermissions)[] = [
  "dashboard",
  "tickets",
  "annual",
  "audits",
  "compare",
  "subscriptions",
  "collab",
  "settings",
  "version",
  "admin",
];

type AccountProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pseudo: string;
  cursorColor: string;
  createdAt: string;
  passwordHash?: string;
  role: "founder" | "admin" | "user";
  pagePermissions: AccountPagePermissions;
  sessionToken: string;
};

const defaultUserPagePermissions: AccountPagePermissions = {
  dashboard: false,
  tickets: false,
  annual: false,
  audits: false,
  compare: false,
  subscriptions: false,
  collab: false,
  settings: true,
  version: true,
  admin: false,
};

const defaultAdminPagePermissions: AccountPagePermissions = {
  dashboard: true,
  tickets: true,
  annual: true,
  audits: true,
  compare: true,
  subscriptions: true,
  collab: true,
  settings: true,
  version: true,
  admin: true,
};

function clonePagePermissions(permissions: AccountPagePermissions): AccountPagePermissions {
  return { ...permissions };
}

type AuthMode = "signin" | "signup";

type SignInForm = {
  email: string;
  password: string;
};

type SignUpForm = {
  firstName: string;
  lastName: string;
  pseudo: string;
  email: string;
  password: string;
  confirmPassword: string;
  cursorColor: string;
};

type AccountSettingsForm = {
  firstName: string;
  lastName: string;
  pseudo: string;
  email: string;
  cursorColor: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type UpdaterStatus = {
  currentVersion: string;
  configured: boolean;
  endpointCount: number;
};

type AvailableUpdate = {
  version: string;
  currentVersion: string;
  notes?: string | null;
  pubDate?: string | null;
};

type CompareMonthState = {
  tickets: Ticket[];
  summary: TicketMonthSummary | null;
  loading: boolean;
  error: string;
  syncedAt: number | null;
};

type MonthDataCacheEntry = {
  tickets: Ticket[];
  summary: TicketMonthSummary;
  reimbursements: ReimbursementDetails;
  syncedAt: number;
};

type CompareSortMode = "delta" | "primary" | "secondary";

type UnexpectedSpendTicket = {
  ticket: Ticket;
  reason: string;
};

type AuditSeverity = "critical" | "warning" | "ok";

type AuditAlert = {
  id: string;
  severity: AuditSeverity;
  icon: string;
  title: string;
  detail: string;
  amount?: number;
};

type AuditFlaggedTicket = {
  key: string;
  ticket: Ticket;
  severity: AuditSeverity;
  reason: string;
};

type AuditRecurringCandidate = {
  key: string;
  label: string;
  category: string;
  currentAmount: number;
  referenceAmount: number;
  delta: number;
  currentCount: number;
  referenceCount: number;
  tracked: boolean;
  trackedLabel: string;
};

type AuditCategoryDelta = {
  category: string;
  currentAmount: number;
  referenceAmount: number;
  delta: number;
  currentCount: number;
  referenceCount: number;
};

type AuditReport = {
  score: number;
  statusLabel: string;
  statusTone: AuditSeverity;
  alerts: AuditAlert[];
  flaggedTickets: AuditFlaggedTicket[];
  recurringCandidates: AuditRecurringCandidate[];
  categoryDeltas: AuditCategoryDelta[];
  underWatchTotal: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
  duplicateGroupCount: number;
  outlierCount: number;
  untrackedRecurringCount: number;
};

type HistorySnapshot = {
  page: PageKey;
  selectedMonth: string;
  ticketSearch: string;
  ticketCategoryFilter: string;
  ticketStatusFilter: TicketStatusFilter;
  ticketSortMode: TicketSortMode;
  reimbursementForm: ReimbursementFormLine;
  sharedNote: string;
};

type HistoryState = {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
};

type HistoryEvent = {
  id: string;
  tone: "info" | "ok" | "warn";
  source: "app" | "sheet";
  title: string;
  detail: string;
  shortcut: "Ctrl+Z" | "Ctrl+Y" | null;
  createdAt: number;
  author?: string;
};

type Collaborator = CollabIdentity & {
  page: PageKey;
  context: string;
  cursorX: number;
  cursorY: number;
  scrollY: number;
  insideBoard: boolean;
  lastSeen: number;
  focusTicketKey: string;
  focusTicketLabel: string;
};

type PointerState = {
  x: number;
  y: number;
  visible: boolean;
  scrollY: number;
};

type CollabSignalKind = "ping" | "assist" | "celebrate" | "focus";

type CollabFeedItem = {
  id: string;
  text: string;
  tone: "info" | "ok" | "warn";
  createdAt: number;
  color: string;
};

type CollabSignal = {
  id: string;
  emoji: string;
  label: string;
  author: string;
  color: string;
  x: number;
  y: number;
  createdAt: number;
};

type CollabMessage =
  | {
      type: "presence";
      user: CollabIdentity;
      page: PageKey;
      context: string;
      timestamp: number;
    }
  | {
      type: "pointer";
      user: CollabIdentity;
      page: PageKey;
      x: number;
      y: number;
      scrollY: number;
      insideBoard: boolean;
      timestamp: number;
    }
  | {
      type: "focus";
      user: CollabIdentity;
      page: PageKey;
      focusTicketKey: string;
      focusTicketLabel: string;
      timestamp: number;
    }
  | {
      type: "note";
      user: CollabIdentity;
      note: string;
      timestamp: number;
    }
  | {
      type: "leave";
      userId: string;
      timestamp: number;
    }
  | {
      type: "signal";
      user: CollabIdentity;
      signalId: string;
      kind: CollabSignalKind;
      x: number;
      y: number;
      timestamp: number;
    }
  | {
      type: "history";
      user: CollabIdentity;
      event: Omit<HistoryEvent, "id" | "createdAt">;
      timestamp: number;
    }
  | {
      type: "subscriptions";
      user: CollabIdentity;
      subscriptions: DashboardSubscription[];
      timestamp: number;
    }
  | {
      type: "permissions";
      targetEmail: string;
      pagePermissions: AccountPagePermissions;
      timestamp: number;
    }
  | {
      type: "importSession";
      user: CollabIdentity;
      session: SharedCsvImportSession | null;
      timestamp: number;
    };

type VoiceStep = "date" | "amount" | "description" | "confirm";

type TicketFollowUpPrompt = {
  keepDate: string;
  voiceEnabled: boolean;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbwiV5Xihpr77T_SthbLxTLijPw2vxTIww619Ys7-PvKSruEiKRc--NXlNDEHuFF3IpmMQ/exec";
const SUPABASE_URL = "https://jyosnqsabeamcaezvrkl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_W_ArI-N5a97me-AXd1MM2w_21_3C1ax";
const SUPABASE_COLLAB_CHANNEL = "budget-pc-live-collab";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 24,
    },
  },
});

const monthOptions: MonthOption[] = [
  { value: "01", label: "Janvier", apiName: "Janvier" },
  { value: "02", label: "Fevrier", apiName: "Février" },
  { value: "03", label: "Mars", apiName: "Mars" },
  { value: "04", label: "Avril", apiName: "Avril" },
  { value: "05", label: "Mai", apiName: "Mai" },
  { value: "06", label: "Juin", apiName: "Juin" },
  { value: "07", label: "Juillet", apiName: "Juillet" },
  { value: "08", label: "Aout", apiName: "Août" },
  { value: "09", label: "Septembre", apiName: "Septembre" },
  { value: "10", label: "Octobre", apiName: "Octobre" },
  { value: "11", label: "Novembre", apiName: "Novembre" },
  { value: "12", label: "Decembre", apiName: "Décembre" },
];

function getCurrentMonthValue() {
  const monthValue = String(new Date().getMonth() + 1).padStart(2, "0");
  return monthOptions.some((month) => month.value === monthValue) ? monthValue : "01";
}

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const categoryOptions = [
  "🛒 Courses",
  "🍔 Fast-Food",
  "🍽️ Restaurant",
  "🚲 Uber eats",
  "📱 Téléphonie",
  "🎬 Netflix",
  "🚚 Amazon Prime",
  "🍏 Apple / Spotify",
  "🧺 Quotidien",
  "⛽ Essence",
  "❓ Autres",
];

const ticketsFinancePreset = {
  monthlyIncome: 2200,
  budgetLines: [
    { key: "courses", label: "Courses", planned: 600, matchCategories: [categoryOptions[0]] },
    { key: "fast_food", label: "Fast-Food / Livraison", planned: 140, matchCategories: [categoryOptions[1], categoryOptions[3]] },
    { key: "restaurant", label: "Restaurant", planned: 120, matchCategories: [categoryOptions[2]] },
    { key: "telephonie", label: "Téléphonie", planned: 109, matchCategories: [categoryOptions[4]] },
    { key: "netflix", label: "Netflix", planned: 21.99, matchCategories: [categoryOptions[5]] },
    { key: "amazon_prime", label: "Amazon Prime", planned: 6.99, matchCategories: [categoryOptions[6]] },
    { key: "apple_spotify", label: "Apple / Spotify", planned: 19.18, matchCategories: [categoryOptions[7]] },
    { key: "quotidien", label: "Quotidien", planned: 120, matchCategories: [categoryOptions[8]] },
    { key: "essence", label: "Essence", planned: 180, matchCategories: [categoryOptions[9]] },
    { key: "autres", label: "Autres", planned: 90, matchCategories: [categoryOptions[10]] },
  ] satisfies TicketBudgetLine[],
};

const unexpectedSpendSheetCategories = [
  "⚕️ Medecin",
  "🚲 Uber eats",
  "🍔 Fast-Food",
  "🍽️Restaurant",
  "📦Cmd. Amazon",
  "🎁Cadeaux",
  "🚃Transport",
  "🕹️Jeux",
  "👖Vêtements",
  "🧺Quotidien",
  "🛠️Voiture",
  "❓ Autres",
  "✈️ Voyage",
] as const;


const voiceStepOrder: VoiceStep[] = ["date", "amount", "description", "confirm"];
const voiceCommandKeywords = {
  confirm: ["valider", "valide", "validee"],
  edit: ["modifier", "modifie", "modifiee"],
  restart: ["recommencer", "recommence"],
  cancel: ["annuler", "annule"],
  yes: ["oui", "ouais", "encore", "continuer"],
  no: ["non", "stop", "terminer", "arreter", "arrêter"],
} as const;

const spokenMonthMap: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  "février": "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  "août": "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  "décembre": "12",
};

const categoryKeywords: Array<{ category: string; keywords: string[] }> = [
  { category: "🏠 Loyer", keywords: ["loyer"] },
  { category: "💡 Electricité", keywords: ["edf", "electricite", "électricité"] },
  { category: "🛒 Courses", keywords: ["course", "courses", "carrefour", "leclerc", "intermarché", "intermarche", "auchan", "lidl", "aldi", "super u", "superu", "monoprix"] },
  { category: "🛡️ Assurance", keywords: ["maaf", "assurance"] },
  { category: "📱 Téléphonie", keywords: ["sfr", "orange", "free mobile", "bouygues", "telephonie", "telephone", "forfait"] },
  { category: "🍏 Apple / Spotify", keywords: ["spotify", "apple", "icloud", "app store", "itunes", "apple music"] },
  { category: "⛽ Essence", keywords: ["essence", "station", "total", "totalenergies", "shell"] },
  { category: "🏋️ Sport", keywords: ["sport", "basic fit", "salle"] },
  { category: "💅 Ongle", keywords: ["ongle"] },
  { category: "💇 Coiffeur", keywords: ["coiffeur", "barbier"] },
  { category: "🎬 Netflix", keywords: ["netflix"] },
  { category: "🟢 Epargne Secours", keywords: ["secours"] },
  { category: "🔵 Epargne Maaf", keywords: ["maaf vie"] },
  { category: "🚚 Amazon Prime", keywords: ["amazon prime", "prime video"] },
  { category: "💳 Carte Revolut", keywords: ["carte revolut", "revolut"] },
  { category: "🎮 Discord", keywords: ["discord"] },
  { category: "🚬 CE", keywords: ["gout ce", "colis raf", "ce"] },
  { category: "⚕️ Medecin", keywords: ["pharmacie", "doctolib", "medecin", "médecin", "dentiste", "chirurgien"] },
  { category: "🚲 Uber eats", keywords: ["uber eats", "ubereats", "deliveroo"] },
  { category: "🍔 Fast-Food", keywords: ["mcdo", "mcdonald", "burger king", "kfc", "subway", "fast food", "burger"] },
  { category: "🍽️Restaurant", keywords: ["restaurant", "resto", "brasserie", "pizzeria"] },
  { category: "📦Cmd. Amazon", keywords: ["amazon"] },
  { category: "🎁Cadeaux", keywords: ["cadeau", "cadeaux"] },
  { category: "🚃Transport", keywords: ["sncf", "ratp", "péage", "peage", "bus", "train", "tram", "parking", "transport"] },
  { category: "🕹️Jeux", keywords: ["steam", "playstation", "xbox", "jeu", "jeux"] },
  { category: "👖Vêtements", keywords: ["vetement", "vêtement", "habille", "zara", "hm", "celio"] },
  { category: "🧺Quotidien", keywords: ["quotidien"] },
  { category: "🛠️Voiture", keywords: ["garage", "vidange", "pneu", "midas", "norauto", "feu vert", "voiture"] },
  { category: "🔁 Paiement 4x", keywords: ["4x", "paiement 4 fois", "paiement 4x"] },
  { category: "✈️ Voyage", keywords: ["voyage", "avion", "hotel", "hôtel", "booking"] },
  { category: "💸Épargne", keywords: ["epargne", "épargne"] },
];

// @ts-expect-error reserved for future use
const _categoryShare = [
  { label: "Fast-food", value: 36, tone: "salmon" },
  { label: "Courses", value: 28, tone: "gold" },
  { label: "Abonnements", value: 21, tone: "sky" },
  { label: "Divers", value: 15, tone: "mint" },
];

const pageMeta: Record<
  PageKey,
  { title: string; subtitle: string; action: string }
> = {
  dashboard: {
    title: "Vue de pilotage",
    subtitle: "Un resume clair des flux budget, tickets et abonnements.",
    action: "Nouvelle depense",
  },
  tickets: {
    title: "Centre des tickets",
    subtitle: "Controle rapide des depenses capturees ce mois-ci.",
    action: "Ajouter un ticket",
  },
  annual: {
    title: "Envoi annuel",
    subtitle: "Prepare tes exports et les lots a envoyer.",
    action: "Creer un lot",
  },
  audits: {
    title: "Audits",
    subtitle: "Repere les anomalies et les postes a verifier.",
    action: "Lancer un audit",
  },
  compare: {
    title: "Comparateur",
    subtitle: "Compare les periodes, les categories et les evolutions.",
    action: "Nouvelle comparaison",
  },
  subscriptions: {
    title: "Abonnements",
    subtitle: "Garde la main sur les couts recurrents de ton budget.",
    action: "Ajouter un abonnement",
  },
  collab: {
    title: "Collab live",
    subtitle: "Prototype multi local pour tester la presence, les curseurs et les idees en direct.",
    action: "Ouvrir une session 2",
  },
  settings: {
    title: "Parametres",
    subtitle: "Personnalise les categories, exports et reglages desktop.",
    action: "Sauvegarder",
  },
  version: {
    title: "Version",
    subtitle: "Mises a jour, notes de version et historique des releases.",
    action: "Verifier",
  },
  admin: {
    title: "Administration",
    subtitle: "Gestion des comptes, roles et acces de l application.",
    action: "Rafraichir",
  },
};

const collabChannelName = "budget-pc-collab-lab";
const collabIdentityStoragePrefix = "budget-pc-collab-identity";
const collabSharedNoteStorageKey = "budget-pc-collab-shared-note";
const authAccountsStorageKey = "budget-pc-auth-accounts";
const authSessionStorageKey = "budget-pc-auth-session";
const dashboardSubscriptionsStorageKey = "budget-pc-dashboard-subscriptions";
const historyEventsStoragePrefix = "budget-pc-history-events";
const collabPresenceTimeoutMs = 7_000;
const collabSignalLifetimeMs = 4_800;
const collabColors = [
  // Chauds
  "#f58d68", "#ff9b7a", "#f2c56e", "#e8a44a", "#f07070", "#e8647a",
  // Froids
  "#90bbea", "#76b8f0", "#76d0b2", "#5ec4b8", "#82c4e8", "#6aabff",
  // Violets / roses
  "#b8a1ff", "#c97aed", "#e08ccc", "#f0a0c8",
  // Neutres lumineux
  "#a8d4a0", "#d4c4a0",
];
const pageKeys: PageKey[] = [
  "dashboard",
  "tickets",
  "annual",
  "audits",
  "compare",
  "subscriptions",
  "collab",
  "settings",
  "version",
];
const collabSignalPresets: Record<
  CollabSignalKind,
  { emoji: string; label: string; tone: "info" | "ok" | "warn" }
> = {
  ping: { emoji: "•", label: "Ping", tone: "info" },
  assist: { emoji: "?", label: "Besoin d aide", tone: "warn" },
  celebrate: { emoji: "+", label: "Bien joue", tone: "ok" },
  focus: { emoji: "@", label: "Regarde ici", tone: "info" },
};
const reimbursementCategoryOptions = ["🚬 CE", "⚕️ Medecin"];

function isPageKey(value: string | null): value is PageKey {
  return value !== null && pageKeys.includes(value as PageKey);
}

function getCollabUrl(page: PageKey, instanceSeed: string) {
  if (typeof window === "undefined") {
    return "/";
  }

  const url = new URL(window.location.href);
  url.searchParams.set("page", page);
  url.searchParams.set("instance", instanceSeed);
  return url.toString();
}

function getInitialPage() {
  if (typeof window === "undefined") {
    return "dashboard" as PageKey;
  }

  const requestedPage = new URL(window.location.href).searchParams.get("page");
  return isPageKey(requestedPage) ? requestedPage : "dashboard";
}

function hashString(value: string) {
  return Array.from(value).reduce((hash, char) => hash + char.charCodeAt(0), 0);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getAccountDisplayName(account: Pick<AccountProfile, "pseudo" | "firstName" | "lastName" | "email">) {
  if (account.pseudo) return account.pseudo;
  const fullName = `${account.firstName} ${account.lastName}`.trim();
  return fullName || account.email;
}

function parseBooleanPermissionValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "oui"].includes(normalized)) return true;
    if (["false", "0", "no", "non"].includes(normalized)) return false;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return fallback;
}

function normalizePagePermissions(
  rawPermissions: unknown,
  fallbackPermissions: AccountPagePermissions
): AccountPagePermissions {
  let source = rawPermissions;

  if (typeof source === "string" && source.trim()) {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  if (!source || typeof source !== "object") {
    return clonePagePermissions(fallbackPermissions);
  }

  const row = source as Record<string, unknown>;

  return accountPagePermissionKeys.reduce((permissions, key) => {
    permissions[key] = parseBooleanPermissionValue(row[key], fallbackPermissions[key]);
    return permissions;
  }, {} as AccountPagePermissions);
}

function normalizeAccountProfile(data: unknown): AccountProfile | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const row = data as Record<string, unknown>;
  const email = normalizeEmail(String(row.email ?? ""));

  if (!email) {
    return null;
  }

  const role: "founder" | "admin" | "user" =
    email === FOUNDER_EMAIL
      ? "founder"
      : row.role === "founder"
        ? "founder"
        : row.role === "admin"
          ? "admin"
          : "user";

  const fallbackPermissions =
    role === "founder" || role === "admin"
      ? defaultAdminPagePermissions
      : defaultUserPagePermissions;

  const rawPermissions = row.pagePermissions ?? row.page_permissions ?? null;
  const pagePermissions =
    role === "founder" || role === "admin"
      ? clonePagePermissions(defaultAdminPagePermissions)
      : normalizePagePermissions(rawPermissions, fallbackPermissions);

  return {
    id: String(row.id ?? row.userId ?? row.uuid ?? email),
    email,
    firstName: String(row.firstName ?? row.first_name ?? row.prenom ?? ""),
    lastName: String(row.lastName ?? row.last_name ?? row.nom ?? ""),
    pseudo: String(row.pseudo ?? row.displayName ?? row.nickname ?? ""),
    cursorColor: String(row.cursorColor ?? row.cursor_color ?? row.color ?? collabColors[0]),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    passwordHash: typeof row.passwordHash === "string" ? row.passwordHash : undefined,
    role,
    pagePermissions,
    sessionToken: String(row.sessionToken ?? row.session_token ?? ""),
  };
}

function loadStoredAccounts() {
  if (typeof window === "undefined") {
    return [] as AccountProfile[];
  }

  const raw = window.localStorage.getItem(authAccountsStorageKey);
  if (!raw) {
    return [] as AccountProfile[];
  }

  try {
    const parsed = JSON.parse(raw) as AccountProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as AccountProfile[];
  }
}

function loadStoredSessionAccount() {
  if (typeof window === "undefined") {
    return null as AccountProfile | null;
  }

  const raw = window.localStorage.getItem(authSessionStorageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const account = normalizeAccountProfile(parsed);
      if (account) {
        return account;
      }
    } catch {
      const legacyEmail = normalizeEmail(raw);
      if (legacyEmail) {
        const legacyAccounts = loadStoredAccounts();
        const legacyAccount = legacyAccounts.find((item) => normalizeEmail(item.email) === legacyEmail);
        if (legacyAccount) {
          return normalizeAccountProfile(legacyAccount);
        }
      }
    }
  }

  const legacyEmail = normalizeEmail(window.localStorage.getItem(authSessionStorageKey) || "");
  if (!legacyEmail) {
    return null as AccountProfile | null;
  }

  const legacyAccounts = loadStoredAccounts();
  const legacyAccount = legacyAccounts.find((item) => normalizeEmail(item.email) === legacyEmail);
  return normalizeAccountProfile(legacyAccount);
}

function persistSessionAccount(account: AccountProfile | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!account) {
    window.localStorage.removeItem(authSessionStorageKey);
    return;
  }

  const normalized = normalizeAccountProfile(account);
  if (!normalized) {
    window.localStorage.removeItem(authSessionStorageKey);
    return;
  }

  window.localStorage.setItem(authSessionStorageKey, JSON.stringify(normalized));
}

function getHistoryEventsStorageKey(email: string) {
  return `${historyEventsStoragePrefix}:${normalizeEmail(email) || "anonymous"}`;
}

function normalizeHistoryEvent(data: unknown): HistoryEvent | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const row = data as Record<string, unknown>;
  const createdAt = toNumber(row.createdAt ?? row.timestamp ?? 0);
  const title = String(row.title ?? "");
  const detail = String(row.detail ?? "");
  const source = row.source === "sheet" ? "sheet" : "app";
  const tone =
    row.tone === "ok" || row.tone === "warn" || row.tone === "info"
      ? row.tone
      : "info";
  const shortcut =
    row.shortcut === "Ctrl+Z" || row.shortcut === "Ctrl+Y"
      ? row.shortcut
      : null;

  if (!createdAt || !title) {
    return null;
  }

  return {
    id: String(row.id ?? `${createdAt}-${hashString(`${source}:${title}:${detail}`)}`),
    tone,
    source,
    title,
    detail,
    shortcut,
    createdAt,
    author: typeof row.author === "string" ? row.author : undefined,
  };
}

function loadStoredHistoryEvents(email: string) {
  if (typeof window === "undefined") {
    return [] as HistoryEvent[];
  }

  const raw = window.localStorage.getItem(getHistoryEventsStorageKey(email));
  if (!raw) {
    return [] as HistoryEvent[];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [] as HistoryEvent[];
    }

    return parsed
      .map((item) => normalizeHistoryEvent(item))
      .filter((item): item is HistoryEvent => item !== null)
      .sort((left, right) => right.createdAt - left.createdAt);
  } catch {
    return [] as HistoryEvent[];
  }
}

function isSameHistoryEvent(left: HistoryEvent, right: HistoryEvent) {
  return (
    left.source === right.source &&
    left.title === right.title &&
    left.detail === right.detail &&
    (left.author || "") === (right.author || "") &&
    left.shortcut === right.shortcut &&
    Math.abs(left.createdAt - right.createdAt) < 1500
  );
}

function prependHistoryEvent(current: HistoryEvent[], event: HistoryEvent) {
  if (current.some((item) => item.id === event.id || isSameHistoryEvent(item, event))) {
    return current;
  }

  return [event, ...current].sort((left, right) => right.createdAt - left.createdAt);
}

function persistCollabIdentity(identity: CollabIdentity) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    `${collabIdentityStoragePrefix}:${identity.seed}`,
    JSON.stringify(identity)
  );
}

function createCollabIdentity(): CollabIdentity {
  if (typeof window === "undefined") {
    return {
      id: "main",
      name: "Session main",
      color: collabColors[0],
      seed: "main",
    };
  }

  const params = new URL(window.location.href).searchParams;
  const seed = params.get("instance") || "main";
  const storageKey = `${collabIdentityStoragePrefix}:${seed}`;
  const stored = window.sessionStorage.getItem(storageKey);

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as CollabIdentity;
      if (parsed?.id && parsed?.name && parsed?.color) {
        return parsed;
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }

  const suffix = seed === "main" ? "main" : seed.slice(-4).toUpperCase();
  const identity: CollabIdentity = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${seed}-${Date.now()}`,
    name: seed === "main" ? "Session main" : `Session ${suffix}`,
    color: collabColors[hashString(seed) % collabColors.length],
    seed,
  };

  persistCollabIdentity(identity);
  return identity;
}

function upsertCollaboratorEntry(current: Collaborator[], next: Collaborator) {
  const existing = current.find((item) => item.id === next.id);
  const merged = existing
    ? {
        ...existing,
        ...next,
      }
    : next;

  return [...current.filter((item) => item.id !== next.id), merged].sort((a, b) =>
    b.lastSeen - a.lastSeen
  );
}

function getPageLabel(page: PageKey) {
  return pageMeta[page].title;
}

function getEditablePermissions(account: AccountProfile): AccountPagePermissions {
  if (account.role === "founder" || account.role === "admin") {
    return clonePagePermissions(defaultAdminPagePermissions);
  }

  return { ...account.pagePermissions };
}

function canAccessPage(account: AccountProfile, page: PageKey) {
  if (account.role === "founder" || account.role === "admin") {
    return true;
  }

  if (page === "admin") {
    return false;
  }

  return Boolean(account.pagePermissions[page]);
}

function getFirstAccessiblePage(account: AccountProfile) {
  return pageKeys.find((candidate) => canAccessPage(account, candidate)) ?? "dashboard";
}

function mergeAccountPermissions(
  account: AccountProfile,
  pagePermissions: AccountPagePermissions
): AccountProfile {
  return normalizeAccountProfile({
    ...account,
    pagePermissions,
  }) ?? account;
}

function getTicketKey(ticket: Ticket) {
  return `${ticket.date}__${ticket.description}__${ticket.amount.toFixed(2)}__${ticket.category}`;
}

function getPresenceContext(page: PageKey, selectedMonth: string) {
  if (page === "tickets" || page === "dashboard") {
    return getSelectedMonthLabel(selectedMonth);
  }

  if (page === "collab") {
    return "Zone multi locale";
  }

  return getPageLabel(page);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "oui" || v === "yes" || v === "envoye";
  }
  return false;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const cleaned = value.trim();

    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned.replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeTicketMonthSummary(data: unknown): TicketMonthSummary | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const payload = data as Record<string, unknown>;
  const rawSummary =
    payload.summary ?? payload.resume ?? payload.metrics ?? payload.kpis ?? null;

  if (!rawSummary || typeof rawSummary !== "object" || Array.isArray(rawSummary)) {
    return null;
  }

  const row = rawSummary as Record<string, unknown>;
  const accountBalance = toNullableNumber(
    row.accountBalance ??
      row.soldeCompte ??
      row.soldeDuCompte ??
      row.soldesDuCompte ??
      row.solde ??
      row.balance
  );
  const currentRemaining = toNullableNumber(
    row.currentRemaining ?? row.resteEnCours ?? row.reste_cours ?? row.remainingCurrent
  );
  const theoreticalRemaining = toNullableNumber(
    row.theoreticalRemaining ??
      row.resteTheorique ??
      row.reste_theorique ??
      row.remainingTheoretical
  );
  const derivedUnexpectedSpend =
    currentRemaining !== null && theoreticalRemaining !== null
      ? currentRemaining - theoreticalRemaining
      : null;
  const unexpectedSpendTotal =
    toNullableNumber(
      row.unexpectedSpendTotal ??
        row.depenseNonPrevueTotal ??
        row.depensesNonPrevues ??
        row.delta ??
        row.ecart
    ) ?? derivedUnexpectedSpend;

  if (
    accountBalance === null &&
    currentRemaining === null &&
    theoreticalRemaining === null &&
    unexpectedSpendTotal === null
  ) {
    return null;
  }

  return {
    accountBalance,
    currentRemaining,
    theoreticalRemaining,
    unexpectedSpendTotal,
    source: "sheet",
  };
}

function normalizeTickets(data: unknown): Ticket[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const payload = data as Record<string, unknown>;

    if (payload.success === false) {
      const backendError = String(payload.error ?? "").trim();
      throw new Error(
        backendError || "Le script Google Sheets a renvoye une erreur."
      );
    }

    if (payload.success === true && Array.isArray(payload.tickets)) {
      return payload.tickets.map((item) => {
        const row = item as Record<string, unknown>;

        return {
          date: String(row.date ?? row.Date ?? row.ticketDate ?? ""),
          description: String(
            row.description ?? row.Description ?? row.libelle ?? row.label ?? ""
          ),
          category: String(
            row.category ?? row.categorie ?? row.Category ?? row["catégorie"] ?? ""
          ),
          amount: toNumber(row.amount ?? row.montant ?? row.Amount ?? 0),
          sent: toBoolean(row.sent ?? row.envoye ?? row.Envoye ?? row.sentToAnnual ?? false),
          sortIndex: toNumber(
            row.sortIndex ?? row.rowIndex ?? row.row ?? row.position ?? row.index ?? Number.NaN
          ),
          sheetRow: toNumber(row.sheetRow ?? Number.NaN),
          blockIndex: toNumber(row.blockIndex ?? Number.NaN),
        };
      });
    }
  }

  const source = Array.isArray(data)
    ? data
    : Array.isArray((data as { tickets?: unknown[] })?.tickets)
    ? (data as { tickets?: unknown[] }).tickets ?? []
    : [];

  if (source.length === 0 && data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data as Record<string, unknown>);
    throw new Error(
      `Format Google Sheets inattendu. Cles recues: ${keys.length > 0 ? keys.join(", ") : "aucune"}.`
    );
  }

  return source.map((item) => {
    const row = item as Record<string, unknown>;

    return {
      date: String(row.date ?? row.Date ?? row.ticketDate ?? ""),
      description: String(
        row.description ?? row.Description ?? row.libelle ?? row.label ?? ""
      ),
      category: String(
        row.category ?? row.categorie ?? row.Category ?? row["catégorie"] ?? ""
      ),
      amount: toNumber(row.amount ?? row.montant ?? row.Amount ?? 0),
      sent: toBoolean(row.sent ?? row.envoye ?? row.Envoye ?? row.sentToAnnual ?? false),
      sortIndex: toNumber(
        row.sortIndex ?? row.rowIndex ?? row.row ?? row.position ?? row.index ?? Number.NaN
      ),
      sheetRow: toNumber(row.sheetRow ?? Number.NaN),
      blockIndex: toNumber(row.blockIndex ?? Number.NaN),
    };
  });
}

function buildSheetsUrl(selectedMonth: string) {
  if (!selectedMonth) {
    return SHEETS_API_URL;
  }

  const url = new URL(SHEETS_API_URL);
  const selected = monthOptions.find((month) => month.value === selectedMonth);
  url.searchParams.set("mois", selected?.apiName ?? selectedMonth);
  return url.toString();
}

function getApiMonthName(selectedMonth: string) {
  return monthOptions.find((month) => month.value === selectedMonth)?.apiName ?? selectedMonth;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeVoiceCommand(value: string) {
  return normalizeText(value)
    .replace(/[^\w\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVoiceKeyword(transcript: string, keywords: readonly string[]) {
  const normalized = normalizeVoiceCommand(transcript);
  return keywords.some((keyword) => normalized.includes(normalizeVoiceCommand(keyword)));
}

function inferCategoryFromTranscript(transcript: string) {
  const normalized = normalizeVoiceCommand(transcript);

  for (const rule of categoryKeywords) {
    if (rule.keywords.some((keyword) => normalized.includes(normalizeVoiceCommand(keyword)))) {
      return rule.category;
    }
  }

  return "";
}

function inferCategoryFromDescription(description: string) {
  const normalized = normalizeText(description.trim());
  if (!normalized) return "";

  for (const rule of categoryKeywords) {
    if (rule.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
      return rule.category;
    }
  }

  return "";
}

function createEmptyCsvImportSummary(): CsvImportSummary {
  return {
    totalRows: 0,
    hardSkippedRows: 0,
    ignoredByReason: [],
  };
}

function createCsvImportDraftId(seed: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `csv-${seed}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCsvHeader(value: string) {
  return normalizeText(value).replace(/[^\w]+/g, " ").trim();
}

function parseCsvTable(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "\"") {
      if (inQuotes && source[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && source[index + 1] === "\n") {
        index += 1;
      }

      row.push(cell.trim());
      cell = "";

      if (row.some((value) => value !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function findCsvColumnIndex(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const normalizedAliases = aliases.map(normalizeCsvHeader);
  const exactMatchIndex = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));

  if (exactMatchIndex >= 0) {
    return exactMatchIndex;
  }

  return normalizedHeaders.findIndex((header) =>
    normalizedAliases.some((alias) => header.includes(alias) || alias.includes(header))
  );
}

function extractCsvImportDate(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function normalizeTicketDateForComparison(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const frMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }

  return "";
}

function getTicketDayStamp(value: string) {
  const normalized = normalizeTicketDateForComparison(value);

  if (!normalized) {
    return Number.NaN;
  }

  return Date.parse(`${normalized}T00:00:00Z`);
}

function getTicketDateDistanceInDays(left: string, right: string) {
  const leftStamp = getTicketDayStamp(left);
  const rightStamp = getTicketDayStamp(right);

  if (!Number.isFinite(leftStamp) || !Number.isFinite(rightStamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((leftStamp - rightStamp) / 86_400_000);
}

function formatCsvImportAmount(amount: number) {
  return Math.abs(amount).toFixed(2).replace(".", ",");
}

function buildCsvImportAmountDateKey(date: string, amount: number) {
  const normalizedDate = normalizeTicketDateForComparison(date) || date.trim();
  return `${normalizedDate}__${amount.toFixed(2)}`;
}

function buildCsvImportDuplicateKey(date: string, description: string, amount: number) {
  const normalizedDate = normalizeTicketDateForComparison(date) || date.trim();
  const normalizedDescription = normalizeText(description)
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return `${normalizedDate}__${normalizedDescription}__${amount.toFixed(2)}`;
}

function buildCsvImportDescriptionTokens(value: string) {
  return normalizeText(value)
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(a|au|aux|de|des|du|la|le|les|to|virement|paiement|clients|particuliers|sa|co)\b/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function areCsvImportDescriptionsLikelySame(left: string, right: string) {
  const leftTokens = buildCsvImportDescriptionTokens(left);
  const rightTokens = buildCsvImportDescriptionTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token));

  if (overlap.length >= Math.min(2, leftTokens.length, rightTokens.length)) {
    return true;
  }

  const leftNormalized = leftTokens.join(" ");
  const rightNormalized = rightTokens.join(" ");
  return leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized);
}

function normalizeTicketCategoryForComparison(value: string) {
  return normalizeText(value).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function createCsvImportParticipant(identity: CollabIdentity, timestamp = Date.now()): CsvImportSessionParticipant {
  return {
    id: identity.id,
    name: identity.name,
    color: identity.color,
    lastSeen: timestamp,
  };
}

function upsertCsvImportParticipant(
  participants: CsvImportSessionParticipant[],
  participant: CsvImportSessionParticipant
) {
  const existing = participants.find((item) => item.id === participant.id);

  if (!existing) {
    return [...participants, participant];
  }

  return participants.map((item) => (item.id === participant.id ? { ...item, ...participant } : item));
}

function normalizeCsvImportSession(value: unknown): SharedCsvImportSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "").trim();

  if (!id) {
    return null;
  }

  const rawDrafts = Array.isArray(row.drafts) ? row.drafts : [];
  const rawParticipants = Array.isArray(row.participants) ? row.participants : [];

  return {
    id,
    ownerId: String(row.ownerId ?? ""),
    ownerName: String(row.ownerName ?? "Une session"),
    ownerColor: String(row.ownerColor ?? collabColors[0]),
    submittingById: String(row.submittingById ?? ""),
    submittingByName: String(row.submittingByName ?? ""),
    fileName: String(row.fileName ?? ""),
    targetMonth: String(row.targetMonth ?? getCurrentMonthValue()),
    summary: {
      totalRows: toNumber((row.summary as Record<string, unknown> | undefined)?.totalRows ?? 0),
      hardSkippedRows: toNumber((row.summary as Record<string, unknown> | undefined)?.hardSkippedRows ?? 0),
      ignoredByReason: Array.isArray((row.summary as Record<string, unknown> | undefined)?.ignoredByReason)
        ? (((row.summary as Record<string, unknown>).ignoredByReason as unknown[]).map((item) => {
            const sub = item as Record<string, unknown>;
            return {
              label: String(sub.label ?? ""),
              count: toNumber(sub.count ?? 0),
            };
          }).filter((item) => item.label))
        : [],
    },
    drafts: rawDrafts.map((item, index) => {
      const draft = item as Record<string, unknown>;
      return {
        id: String(draft.id ?? `draft-${index}`),
        sourceRow: toNumber(draft.sourceRow ?? index + 1),
        sourceType: String(draft.sourceType ?? "Operation"),
        include: toBoolean(draft.include ?? true),
        note: String(draft.note ?? ""),
        date: String(draft.date ?? ""),
        amount: String(draft.amount ?? ""),
        description: String(draft.description ?? ""),
        category: String(draft.category ?? ""),
        error: String(draft.error ?? ""),
      };
    }),
    participants: rawParticipants.map((item) => {
      const participant = item as Record<string, unknown>;
      return {
        id: String(participant.id ?? ""),
        name: String(participant.name ?? "Une session"),
        color: String(participant.color ?? collabColors[0]),
        lastSeen: toNumber(participant.lastSeen ?? Date.now()),
      };
    }).filter((item) => item.id),
    status: String(row.status ?? ""),
    startedAt: toNumber(row.startedAt ?? Date.now()),
    updatedAt: toNumber(row.updatedAt ?? Date.now()),
  };
}

function buildCsvImportAccountTokens(
  account: Pick<AccountProfile, "firstName" | "lastName" | "pseudo" | "email"> | null
) {
  if (!account) {
    return [];
  }

  const fullName = `${account.firstName} ${account.lastName}`.trim();
  const parts = [
    account.firstName,
    account.lastName,
    account.pseudo,
    fullName,
    account.email.split("@")[0] ?? "",
  ];

  return [...new Set(
    parts
      .flatMap((value) => normalizeText(value).split(/[\s._-]+/))
      .map((value) => value.trim())
      .filter((value) => value.length >= 3)
  )];
}

function isLikelyCsvSelfTransfer(
  description: string,
  type: string,
  account: Pick<AccountProfile, "firstName" | "lastName" | "pseudo" | "email"> | null
) {
  if (!account) {
    return false;
  }

  const normalizedDescription = normalizeText(description)
    .replace(/\s+/g, " ")
    .trim();
  const normalizedType = normalizeText(type);
  const fullName = normalizeText(`${account.firstName} ${account.lastName}`.trim())
    .replace(/\s+/g, " ")
    .trim();
  const isTransferLike =
    normalizedType.includes("virement") ||
    normalizedDescription.includes("virement a") ||
    normalizedDescription.includes("transfer to") ||
    normalizedDescription.startsWith("to ");

  if (!isTransferLike) {
    return false;
  }

  if (fullName && normalizedDescription.includes(fullName)) {
    return true;
  }

  const tokens = buildCsvImportAccountTokens(account);
  const matches = tokens.filter((token) => normalizedDescription.includes(token));
  return matches.length >= 2;
}

function isLikelyExistingCsvDuplicate(
  row: CsvImportParsedRow,
  existingTickets: Ticket[],
  inferredCategory: string
) {
  const matchingAmountTickets = existingTickets.filter(
    (ticket) => Math.abs(ticket.amount - Math.abs(row.signedAmount)) < 0.001
  );

  if (matchingAmountTickets.length === 0) {
    return false;
  }

  const nearbyAmountTickets = matchingAmountTickets.filter((ticket) => {
    return getTicketDateDistanceInDays(ticket.date, row.dateStart) <= 1;
  });

  if (nearbyAmountTickets.length === 0) {
    return false;
  }

  const normalizedCsvCategory = normalizeTicketCategoryForComparison(inferredCategory);
  const hasStrongTextOrCategoryMatch = nearbyAmountTickets.some((ticket) => {
    const normalizedExistingCategory = normalizeTicketCategoryForComparison(ticket.category || "");

    if (
      normalizedCsvCategory &&
      normalizedExistingCategory &&
      normalizedCsvCategory === normalizedExistingCategory
    ) {
      return true;
    }

    return areCsvImportDescriptionsLikelySame(row.description, ticket.description || "");
  });

  if (hasStrongTextOrCategoryMatch) {
    return true;
  }

  return nearbyAmountTickets.length === 1 && matchingAmountTickets.length === 1;
}

function consumeCsvImportMatchCounter(counter: Map<string, number>, key: string) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function detectCsvImportTargetMonth(rows: CsvImportParsedRow[], preferredMonth: string) {
  const monthCounts = rows.reduce((map, row) => {
    map.set(row.month, (map.get(row.month) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  if (monthCounts.size === 0) {
    return preferredMonth;
  }

  return [...monthCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      if (left[0] === preferredMonth) {
        return -1;
      }

      if (right[0] === preferredMonth) {
        return 1;
      }

      return right[0].localeCompare(left[0], "fr");
    })[0][0];
}

function parseRevolutCsvImport(
  csvText: string,
  preferredMonth: string,
  existingTickets: Ticket[],
  account: Pick<AccountProfile, "firstName" | "lastName" | "pseudo" | "email"> | null
) {
  const rows = parseCsvTable(csvText);

  if (rows.length < 2) {
    throw new Error("Le fichier CSV semble vide ou incomplet.");
  }

  const [headers, ...dataRows] = rows;
  const indices = {
    type: findCsvColumnIndex(headers, ["Type"]),
    dateStart: findCsvColumnIndex(headers, ["Date de debut", "Date de début", "Date debut"]),
    description: findCsvColumnIndex(headers, ["Description"]),
    amount: findCsvColumnIndex(headers, ["Montant"]),
    state: findCsvColumnIndex(headers, ["Etat", "État"]),
  };

  if (indices.dateStart < 0 || indices.description < 0 || indices.amount < 0) {
    throw new Error("Colonnes Revolut introuvables dans ce CSV.");
  }

  const ignoredByReason = new Map<string, number>();
  const candidateRows: CsvImportParsedRow[] = [];
  const drafts: CsvImportDraft[] = [];

  const incrementIgnoredReason = (label: string) => {
    ignoredByReason.set(label, (ignoredByReason.get(label) ?? 0) + 1);
  };

  dataRows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + 2;
    const read = (columnIndex: number) =>
      columnIndex >= 0 ? String(row[columnIndex] ?? "").trim() : "";

    const sourceType = read(indices.type);
    const dateStart = extractCsvImportDate(read(indices.dateStart));
    const description = read(indices.description);
    const rawAmount = read(indices.amount);
    const signedAmount = toNumber(rawAmount);
    const state = read(indices.state);

    if (!description) {
      incrementIgnoredReason("Description vide");
      return;
    }

    if (!dateStart) {
      incrementIgnoredReason("Date de debut invalide");
      return;
    }

    if (indices.state >= 0 && normalizeText(state) !== "termine") {
      incrementIgnoredReason("Etat non termine");
      return;
    }

    if (!(signedAmount < 0)) {
      incrementIgnoredReason("Montant positif ou nul");
      return;
    }

    candidateRows.push({
      sourceRow,
      sourceType: sourceType || "Operation",
      dateStart,
      month: dateStart.slice(5, 7),
      description,
      signedAmount,
    });
  });

  const targetMonth = detectCsvImportTargetMonth(candidateRows, preferredMonth);
  const existingExactDuplicateCounts = existingTickets.reduce((map, ticket) => {
    const key = buildCsvImportDuplicateKey(ticket.date, ticket.description, Math.abs(ticket.amount));
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const existingAmountDateCounts = existingTickets.reduce((map, ticket) => {
    const key = buildCsvImportAmountDateKey(ticket.date, Math.abs(ticket.amount));
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const consumedExactDuplicateCounts = new Map<string, number>();
  const consumedAmountDateCounts = new Map<string, number>();
  const acceptedDraftKeys = new Set<string>();

  candidateRows.forEach((row) => {
    const absoluteAmount = Math.abs(row.signedAmount);
    const inferredCategory = inferCategoryFromDescription(row.description);

    if (row.month !== targetMonth) {
      incrementIgnoredReason("Autre mois detecte dans le CSV");
      return;
    }

    const selfTransfer = isLikelyCsvSelfTransfer(row.description, row.sourceType, account);

    if (selfTransfer) {
      incrementIgnoredReason("Auto-virement ignore");
      return;
    }

    const exactDuplicateKey = buildCsvImportDuplicateKey(row.dateStart, row.description, absoluteAmount);
    const amountDateKey = buildCsvImportAmountDateKey(row.dateStart, absoluteAmount);
    const matchingExistingExactCount = existingExactDuplicateCounts.get(exactDuplicateKey) ?? 0;
    const consumedExistingExactCount = consumedExactDuplicateCounts.get(exactDuplicateKey) ?? 0;
    const matchingExistingAmountDateCount = existingAmountDateCounts.get(amountDateKey) ?? 0;
    const consumedExistingAmountDateCount = consumedAmountDateCounts.get(amountDateKey) ?? 0;

    if (acceptedDraftKeys.has(exactDuplicateKey)) {
      incrementIgnoredReason("Doublon dans le CSV");
      return;
    }

    if (matchingExistingExactCount > consumedExistingExactCount) {
      consumeCsvImportMatchCounter(consumedExactDuplicateCounts, exactDuplicateKey);
      consumeCsvImportMatchCounter(consumedAmountDateCounts, amountDateKey);
      incrementIgnoredReason("Ticket deja present sur ce mois");
      return;
    }

    if (matchingExistingAmountDateCount > consumedExistingAmountDateCount) {
      consumeCsvImportMatchCounter(consumedAmountDateCounts, amountDateKey);
      incrementIgnoredReason("Ticket deja present sur ce mois");
      return;
    }

    if (isLikelyExistingCsvDuplicate(row, existingTickets, inferredCategory)) {
      incrementIgnoredReason("Ticket deja present sur ce mois");
      return;
    }

    acceptedDraftKeys.add(exactDuplicateKey);

    drafts.push({
      id: createCsvImportDraftId(`${row.sourceRow}`),
      sourceRow: row.sourceRow,
      sourceType: row.sourceType,
      include: true,
      note: "",
      date: row.dateStart,
      amount: formatCsvImportAmount(absoluteAmount),
      description: row.description,
      category: inferredCategory,
      error: "",
    });
  });

  return {
    targetMonth,
    drafts,
    summary: {
      totalRows: dataRows.length,
      hardSkippedRows: [...ignoredByReason.values()].reduce((sum, count) => sum + count, 0),
      ignoredByReason: [...ignoredByReason.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    } satisfies CsvImportSummary,
  };
}

function inferAmountFromTranscript(transcript: string) {
  const match = transcript.match(/(\d+(?:[.,]\d{1,2})?)/);
  return match ? match[1].replace(".", ",") : "";
}

function parseVoiceAmount(transcript: string) {
  const normalized = normalizeVoiceCommand(transcript)
    .replace(/\beuros?\b/g, " ")
    .replace(/\bvirgule\b/g, ".")
    .replace(/\bpoint\b/g, ".")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  const withDecimals = normalized.match(/\b(\d+)\s*[.]\s*(\d{1,2})\b/);
  if (withDecimals) {
    return `${withDecimals[1]},${withDecimals[2].padStart(2, "0")}`;
  }

  const splitEuros = normalized.match(/\b(\d+)\s+(\d{1,2})\b/);
  if (splitEuros) {
    return `${splitEuros[1]},${splitEuros[2].padStart(2, "0")}`;
  }

  return inferAmountFromTranscript(normalized);
}

function detectVoiceCategory(transcript: string) {
  return inferCategoryFromTranscript(transcript);
}

function toTitleCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function cleanDescriptionTranscript(transcript: string) {
  return toTitleCase(
    transcript
      .replace(/\b(valider|valide|validee|validée|modifier|modifie|modifiee|modifiée|recommencer|recommence|annuler|annule)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getVoiceStepLabel(step: VoiceStep) {
  if (step === "date") return "Date";
  if (step === "amount") return "Montant";
  if (step === "description") return "Description";
  return "Confirmation";
}

function getVoiceStepPrompt(step: VoiceStep, form: NewTicketForm) {
  if (step === "date") return "Dis la date du ticket. Exemple: aujourd'hui ou 12 avril.";
  if (step === "amount") return "Dis le montant. Exemple: 18 euros 50.";
  if (step === "description") return "Dis la description. Exemple: Carrefour ou Netflix.";
  return form.category
    ? `Verifie le recap puis dis valider, modifier ou annuler. Categorie detectee: ${form.category}.`
    : "Verifie le recap. Si la categorie n a pas ete trouvee, choisis-la puis dis valider, modifier ou annuler.";
}

function getAnotherTicketVoicePrompt() {
  return "Ticket enregistre. Veux-tu ajouter un autre ticket ? Dis oui ou non.";
}

function formatVoiceDate(transcript: string) {
  const normalized = normalizeVoiceCommand(transcript);
  if (normalized.includes("aujourd")) {
    return new Date().toISOString().slice(0, 10);
  }

  if (normalized.includes("demain")) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  if (normalized.includes("hier")) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().slice(0, 10);
  }

  const match = transcript.match(/(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  const frenchMonthMatch = normalized.match(
    /\b(\d{1,2})\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)(?:\s+(\d{4}))?\b/
  );

  if (frenchMonthMatch) {
    const day = frenchMonthMatch[1].padStart(2, "0");
    const month = spokenMonthMap[frenchMonthMatch[2]] ?? "";
    const year = frenchMonthMatch[3] || String(new Date().getFullYear());

    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  return "";
}

function applyVoiceStepValue(step: VoiceStep, transcript: string, form: NewTicketForm) {
  if (step === "date") {
    return { date: formatVoiceDate(transcript) || form.date };
  }

  if (step === "amount") {
    return { amount: parseVoiceAmount(transcript) || form.amount };
  }

  if (step === "description") {
    const description = cleanDescriptionTranscript(transcript) || form.description;
    return {
      description,
      category: detectVoiceCategory(description) || form.category,
    };
  }

  return {};
}

function getNextVoiceStep(step: VoiceStep) {
  const currentIndex = voiceStepOrder.indexOf(step);
  return voiceStepOrder[Math.min(currentIndex + 1, voiceStepOrder.length - 1)];
}

function getVoiceStepState(step: VoiceStep, currentStep: VoiceStep, form: NewTicketForm) {
  const orderIndex = voiceStepOrder.indexOf(step);
  const currentIndex = voiceStepOrder.indexOf(currentStep);

  const isComplete =
    (step === "date" && Boolean(form.date)) ||
    (step === "amount" && Boolean(form.amount)) ||
    (step === "description" && Boolean(form.description.trim())) ||
    (step === "confirm" && currentIndex > orderIndex);

  if (step === currentStep) return "active";
  if (isComplete || orderIndex < currentIndex) return "done";
  return "idle";
}

function getTicketDateValue(ticket: Ticket) {
  const match = ticket.date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return 0;
  }

  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T00:00:00`).getTime();
}

function getTicketSortIndex(ticket: Ticket) {
  return Number.isFinite(ticket.sortIndex) ? (ticket.sortIndex as number) : Number.MAX_SAFE_INTEGER;
}

const SHEET_ALL_CATEGORIES = [
  "🏠 Loyer",
  "💡 Electricité",
  "🛒 Courses",
  "🛡️ Assurance",
  "📱 Téléphonie",
  "🍏 Apple / Spotify",
  "⛽ Essence",
  "🏋️ Sport",
  "💅 Ongle",
  "💇 Coiffeur",
  "🎬 Netflix",
  "🟢 Epargne Secours",
  "🔵 Epargne Maaf",
  "🚚 Amazon Prime",
  "💳 Carte Revolut",
  "🎮 Discord",
  "🚬 CE",
  "⚕️ Medecin",
  "🚲 Uber eats",
  "🍔 Fast-Food",
  "🍽️Restaurant",
  "📦Cmd. Amazon",
  "🎁Cadeaux",
  "🚃Transport",
  "🕹️Jeux",
  "👖Vêtements",
  "🧺Quotidien",
  "🛠️Voiture",
  "❓ Autres",
  "🔁 Paiement 4x",
  "✈️ Voyage",
  "💸Épargne",
];


function filterAndSortTickets(
  tickets: Ticket[],
  searchQuery: string,
  categoryFilter: string,
  statusFilter: TicketStatusFilter,
  sortMode: TicketSortMode
) {
  const normalizedQuery = normalizeText(searchQuery.trim());

  const filtered = tickets.filter((ticket) => {
    const matchesQuery =
      !normalizedQuery ||
      normalizeText(`${ticket.description} ${ticket.category} ${ticket.date}`).includes(normalizedQuery);

    const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "sent" && ticket.sent) ||
      (statusFilter === "pending" && !ticket.sent);

    return matchesQuery && matchesCategory && matchesStatus;
  });

  return [...filtered].sort((left, right) => {
    if (sortMode === "date_asc") {
      const dateDiff = getTicketDateValue(left) - getTicketDateValue(right);
      if (dateDiff !== 0) {
        return dateDiff;
      }

      return getTicketSortIndex(left) - getTicketSortIndex(right);
    }

    if (sortMode === "date_desc") {
      const dateDiff = getTicketDateValue(right) - getTicketDateValue(left);
      if (dateDiff !== 0) {
        return dateDiff;
      }

      return getTicketSortIndex(right) - getTicketSortIndex(left);
    }

    if (sortMode === "amount_asc") {
      return left.amount - right.amount;
    }

    if (sortMode === "amount_desc") {
      return right.amount - left.amount;
    }

    return left.description.localeCompare(right.description, "fr");
  });
}

async function fetchTicketsFromSheets(selectedMonth: string) {
  const requestUrl = new URL(buildSheetsUrl(selectedMonth));
  requestUrl.searchParams.set("_ts", String(Date.now()));

  try {
    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } catch (browserError) {
    const isTauriRuntime =
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window;

    if (!isTauriRuntime) {
      throw browserError;
    }

    return invoke<unknown>("fetch_google_sheets", { url: requestUrl.toString() });
  }
}

async function postSheetsAction(payload: Record<string, unknown>) {
  try {
    const response = await fetch(SHEETS_API_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } catch (browserError) {
    const isTauriRuntime =
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window;

    if (!isTauriRuntime) {
      throw browserError;
    }

    return invoke<unknown>("post_google_sheets", {
      url: SHEETS_API_URL,
      payload,
    });
  }
}

async function createTicketInSheets(selectedMonth: string, form: NewTicketForm) {
  return postSheetsAction({
    action: "addTicket",
    mois: getApiMonthName(selectedMonth),
    date: form.date,
    montant: form.amount,
    description: form.description,
    categorie: form.category,
  });
}

async function updateTicketInSheets(
  selectedMonth: string,
  sheetRow: number,
  blockIndex: number,
  form: { date: string; amount: string; description: string; category: string }
) {
  return postSheetsAction({
    action: "updateTicket",
    mois: getApiMonthName(selectedMonth),
    sheetRow,
    blockIndex,
    date: form.date,
    montant: form.amount,
    description: form.description,
    categorie: form.category,
  });
}

function createEmptyReimbursementLine(): ReimbursementFormLine {
  return {
    category: "",
    amount: "",
  };
}

async function createReimbursementsInSheets(
  selectedMonth: string,
  entries: (ReimbursementFormLine & { targetRow?: number })[]
) {
  return postSheetsAction({
    action: "addReimbursements",
    mois: getApiMonthName(selectedMonth),
    entries: entries
      .map((entry) => ({
        categorie: entry.category,
        montant: entry.amount,
        row: entry.targetRow,
      }))
      .filter((entry) => String(entry.categorie).trim() || String(entry.montant).trim()),
  });
}

async function deleteReimbursementInSheets(selectedMonth: string, row: number) {
  return postSheetsAction({
    action: "deleteReimbursement",
    mois: getApiMonthName(selectedMonth),
    row,
  });
}

function normalizeReimbursementDetails(data: unknown): ReimbursementDetails {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      entries: [],
      ceTotal: 0,
      medecinTotal: 0,
      total: 0,
    };
  }

  const payload = data as Record<string, unknown>;
  const raw =
    payload.reimbursements ??
    payload.remboursements ??
    payload.reimbursementDetails ??
    null;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      entries: [],
      ceTotal: 0,
      medecinTotal: 0,
      total: 0,
    };
  }

  const row = raw as Record<string, unknown>;
  const rawEntries = Array.isArray(row.entries) ? row.entries : [];
  const entries = rawEntries.map((entry) => {
    const current = entry as Record<string, unknown>;
    return {
      row: toNumber(current.row ?? current.ligne ?? 0),
      category: String(current.category ?? current.categorie ?? ""),
      amount: toNumber(current.amount ?? current.montant ?? 0),
    };
  });

  return {
    entries,
    ceTotal: toNumber(row.ceTotal ?? row.ce_total ?? 0),
    medecinTotal: toNumber(row.medecinTotal ?? row.medecin_total ?? 0),
    total: toNumber(row.total ?? 0),
  };
}

function normalizeAuthResponseAccount(data: unknown) {
  const payload = data as Record<string, unknown>;
  const account = normalizeAccountProfile(payload.account ?? payload.user ?? payload.profile ?? null);

  if (!account) {
    const keys = data && typeof data === "object" ? Object.keys(payload) : [];
    throw new Error(
      `Reponse compte invalide. Cles recues: ${keys.length ? keys.join(", ") : "aucune"}.`
    );
  }

  return account;
}

async function signInAccountInSheets(email: string, password: string) {
  const response = (await postSheetsAction({
    action: "signInAccount",
    email,
    password,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    throw new Error(response.error || "Connexion refusee par le serveur.");
  }

  return normalizeAuthResponseAccount(response);
}

async function signUpAccountInSheets(form: SignUpForm) {
  const response = (await postSheetsAction({
    action: "signUpAccount",
    email: normalizeEmail(form.email),
    password: form.password,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    pseudo: form.pseudo.trim(),
    cursorColor: form.cursorColor,
    pagePermissions: defaultUserPagePermissions,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    throw new Error(response.error || "Creation du compte refusee par le serveur.");
  }

  return normalizeAuthResponseAccount(response);
}

async function updateRemoteAccountInSheets(
  currentAccount: AccountProfile,
  form: AccountSettingsForm
) {
  const response = (await postSheetsAction({
    action: "updateAccountProfile",
    currentEmail: currentAccount.email,
    currentPassword: form.currentPassword,
    nextEmail: normalizeEmail(form.email),
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    pseudo: form.pseudo.trim(),
    cursorColor: form.cursorColor,
    newPassword: form.newPassword,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    throw new Error(response.error || "Mise a jour du compte refusee par le serveur.");
  }

  return normalizeAuthResponseAccount(response);
}

async function updateQuickProfileInSheets(
  account: AccountProfile,
  pseudo: string,
  cursorColor: string
) {
  const response = (await postSheetsAction({
    action: "updateQuickProfile",
    email: account.email,
    pseudo: pseudo.trim(),
    cursorColor,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    throw new Error(response.error || "Mise a jour du profil rapide refusee par le serveur.");
  }

  return normalizeAuthResponseAccount(response);
}

async function fetchAllUsersFromSheets(adminEmail: string, sessionToken: string) {
  const response = (await postSheetsAction({
    action: "listAllAccounts",
    adminEmail,
    sessionToken,
  })) as { success?: boolean; error?: string; accounts?: unknown[] };

  if (response?.success === false) {
    throw new Error(response.error || "Acces refuse.");
  }

  const rawAccounts = Array.isArray(response?.accounts) ? response.accounts : [];
  return rawAccounts
    .map((a) => normalizeAccountProfile(a))
    .filter((a): a is AccountProfile => a !== null);
}

const FOUNDER_EMAIL = "schjeanseb@gmail.com";

function isPrivileged(account: AccountProfile) {
  return account.role === "founder" || account.role === "admin";
}

async function updateUserRoleInSheets(
  adminEmail: string,
  sessionToken: string,
  targetEmail: string,
  newRole: "admin" | "user"
) {
  const response = (await postSheetsAction({
    action: "updateUserRole",
    adminEmail,
    sessionToken,
    targetEmail,
    role: newRole,
  })) as { success?: boolean; error?: string };

  if (response?.success === false) {
    throw new Error(response.error || "Mise a jour du role refusee.");
  }

  return response;
}

async function updateUserPermissionsInSheets(
  adminEmail: string,
  sessionToken: string,
  targetEmail: string,
  pagePermissions: AccountPagePermissions
) {
  const response = (await postSheetsAction({
    action: "updateUserPermissions",
    adminEmail,
    sessionToken,
    targetEmail,
    pagePermissions,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    if ((response.error || "").toLowerCase().includes("action inconnue")) {
      throw new Error(
        "Backend Google Apps Script pas encore mis a jour: redeploie APPS_SCRIPT.md pour activer updateUserPermissions."
      );
    }

    throw new Error(response.error || "Mise a jour des autorisations refusee.");
  }

  return normalizeAuthResponseAccount(response);
}

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Erreur inconnue Google Sheets.";
    }
  }

  return "Impossible de charger les tickets Google Sheets.";
}

function normalizeCollaboratorPage(value: unknown): PageKey {
  const candidate = typeof value === "string" ? value : "";
  return isPageKey(candidate) ? candidate : "collab";
}

function normalizeRemoteCollaborator(value: unknown): Collaborator | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const id = String(row.id ?? row.sessionId ?? "").trim();

  if (!id) {
    return null;
  }

  return {
    id,
    seed: String(row.seed ?? id),
    name: String(row.name ?? "Session distante"),
    color: String(row.color ?? collabColors[0]),
    page: normalizeCollaboratorPage(row.page),
    context: String(row.context ?? ""),
    cursorX: toNumber(row.cursorX ?? row.x ?? 50),
    cursorY: toNumber(row.cursorY ?? row.y ?? 50),
    scrollY: toNumber(row.scrollY ?? 0),
    insideBoard: toBoolean(row.insideBoard ?? row.inside ?? false),
    lastSeen: toNumber(row.lastSeen ?? row.timestamp ?? Date.now()),
    focusTicketKey: String(row.focusTicketKey ?? ""),
    focusTicketLabel: String(row.focusTicketLabel ?? ""),
  };
}

function mergeCollaboratorLists(local: Collaborator[], remote: Collaborator[]) {
  const merged = new Map<string, Collaborator>();

  [...remote, ...local].forEach((item) => {
    const existing = merged.get(item.id);

    if (!existing || item.lastSeen >= existing.lastSeen) {
      merged.set(item.id, item);
    }
  });

  return [...merged.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function buildSupabasePresencePayload(
  identity: CollabIdentity,
  page: PageKey,
  selectedMonth: string,
  pointer: PointerState,
  focus: { key: string; label: string },
  sharedNote: string,
  sharedNoteUpdatedAt: number
) {
  return {
    id: identity.id,
    seed: identity.seed,
    name: identity.name,
    color: identity.color,
    page,
    context: getPresenceContext(page, selectedMonth),
    cursorX: pointer.x,
    cursorY: pointer.y,
    scrollY: pointer.scrollY,
    insideBoard: pointer.visible,
    lastSeen: Date.now(),
    focusTicketKey: focus.key,
    focusTicketLabel: focus.label,
    sharedNoteText: sharedNote,
    sharedNoteUpdatedAt,
    sharedNoteUpdatedBy: identity.name,
  };
}

function pruneRemoteCollaborators(current: Collaborator[]) {
  const now = Date.now();
  return current.filter((item) => now - item.lastSeen < collabPresenceTimeoutMs * 2);
}

function pruneCollabSignals(current: CollabSignal[]) {
  const now = Date.now();
  return current.filter((item) => now - item.createdAt < collabSignalLifetimeMs);
}

function appendCollabFeedItem(current: CollabFeedItem[], next: CollabFeedItem) {
  const merged = [next, ...current.filter((item) => item.id !== next.id)];
  return merged
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
}

function appendCollabSignal(current: CollabSignal[], next: CollabSignal) {
  return pruneCollabSignals([next, ...current.filter((item) => item.id !== next.id)]);
}

function formatPresenceAge(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp);
  const seconds = Math.round(diff / 1000);

  if (seconds <= 2) {
    return "maintenant";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function buildCollabFeedItem(
  id: string,
  text: string,
  tone: "info" | "ok" | "warn",
  color: string,
  createdAt: number
): CollabFeedItem {
  return { id, text, tone, color, createdAt };
}

function createCollabSignalBubble(
  signalId: string,
  kind: CollabSignalKind,
  author: string,
  color: string,
  x: number,
  y: number,
  createdAt: number
) {
  const preset = collabSignalPresets[kind];

  return {
    id: signalId,
    emoji: preset.emoji,
    label: preset.label,
    author,
    color,
    x,
    y,
    createdAt,
  } satisfies CollabSignal;
}

function renderGoogleSheetsError(error: string) {
  const lowerError = error.toLowerCase();
  const probableCause = lowerError.includes("getrecapdata")
    ? "la fonction getRecapData manque dans Apps Script ou n est pas dans le bon projet"
    : lowerError.includes("onglet introuvable")
      ? "le mois demande n existe pas dans le Google Sheet"
      : lowerError.includes("access") || lowerError.includes("autor")
        ? "acces public ou autorisations Apps Script incorrectes"
        : "acces public, JSON invalide, colonnes non reconnues";

  return (
    <div className="error-box">
      <strong>Diagnostic Google Sheets</strong>
      <p>{error}</p>
      <div className="error-meta">
        <span>Source</span>
        <code>{SHEETS_API_URL}</code>
      </div>
      <div className="error-meta">
        <span>Causes probables</span>
        <code>{probableCause}</code>
      </div>
    </div>
  );
}

function getSelectedMonthLabel(selectedMonth: string) {
  return monthOptions.find((month) => month.value === selectedMonth)?.label ?? selectedMonth;
}

function createEmptyCompareMonthState(): CompareMonthState {
  return {
    tickets: [],
    summary: null,
    loading: false,
    error: "",
    syncedAt: null,
  };
}

function createEmptyReimbursementDetails(): ReimbursementDetails {
  return {
    entries: [],
    ceTotal: 0,
    medecinTotal: 0,
    total: 0,
  };
}

function getRelativeMonthValue(baseMonth: string, offset: number) {
  const index = monthOptions.findIndex((month) => month.value === baseMonth);

  if (index === -1) {
    return monthOptions[0]?.value ?? "01";
  }

  return monthOptions[(index + offset + monthOptions.length) % monthOptions.length]?.value ?? baseMonth;
}

function buildFallbackTicketMonthSummary(tickets: Ticket[]): TicketMonthSummary {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const budgetLines = computeTicketBudgetLines(tickets);
  const budgetPlannedTotal = budgetLines.reduce((sum, line) => sum + line.planned, 0);
  const currentRemaining = ticketsFinancePreset.monthlyIncome - monthlyTotal;
  const theoreticalRemaining = ticketsFinancePreset.monthlyIncome - budgetPlannedTotal;

  return {
    accountBalance: null,
    currentRemaining,
    theoreticalRemaining,
    unexpectedSpendTotal: currentRemaining - theoreticalRemaining,
    source: "fallback",
  };
}

function normalizeMonthDataPayload(data: unknown): {
  tickets: Ticket[];
  summary: TicketMonthSummary;
  reimbursements: ReimbursementDetails;
} {
  const tickets = normalizeTickets(data);
  const summary =
    normalizeTicketMonthSummary(data) ?? buildFallbackTicketMonthSummary(tickets);
  const reimbursements = normalizeReimbursementDetails(data);

  return {
    tickets,
    summary,
    reimbursements,
  };
}

function formatElapsedSyncDuration(elapsedSeconds: number) {
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} sec`;
  }

  if (elapsedSeconds < 3600) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes} min ${String(seconds).padStart(2, "0")}`;
  }

  if (elapsedSeconds < 86400) {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  }

  const days = Math.floor(elapsedSeconds / 86400);
  const hours = Math.floor((elapsedSeconds % 86400) / 3600);
  return `${days} j ${String(hours).padStart(2, "0")} h`;
}

function formatRelativeSyncAge(syncedAt: number, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - syncedAt) / 1000));
  return `il y a ${formatElapsedSyncDuration(elapsedSeconds)}`;
}

type LiveRelativeSyncLabelProps = {
  syncedAt: number | null;
  loading?: boolean;
  loadingLabel?: string;
  waitingLabel?: string;
  prefix?: string;
};

function LiveRelativeSyncLabel({
  syncedAt,
  loading = false,
  loadingLabel = "Synchro en cours...",
  waitingLabel = "Synchro en attente",
  prefix = "Synchro",
}: LiveRelativeSyncLabelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!loading && syncedAt === null) {
      return;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loading, syncedAt]);

  if (loading) {
    return <>{loadingLabel}</>;
  }

  if (!syncedAt) {
    return <>{waitingLabel}</>;
  }

  const label = formatRelativeSyncAge(syncedAt, now);

  return <>{prefix ? `${prefix} ${label}` : label}</>;
}

function computeTicketBudgetLines(tickets: Ticket[]): TicketBudgetComputedLine[] {
  return ticketsFinancePreset.budgetLines.map((line) => {
    const actual = tickets
      .filter((ticket) => line.matchCategories.includes(ticket.category))
      .reduce((sum, ticket) => sum + ticket.amount, 0);

    return {
      ...line,
      actual,
      difference: actual - line.planned,
    };
  });
}

function formatBudgetDifference(value: number) {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${euro.format(abs)}`;
}

function getBudgetDifferenceTone(value: number) {
  if (value > 0.009) return "warn";
  if (value < -0.009) return "ok";
  return "neutral";
}

function buildCompareMonthMetrics(
  tickets: Ticket[],
  summary: TicketMonthSummary | null
) {
  const total = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const sentCount = tickets.filter((ticket) => ticket.sent).length;
  const pendingCount = tickets.length - sentCount;
  const averageTicket = tickets.length > 0 ? total / tickets.length : 0;
  const budgetLines = computeTicketBudgetLines(tickets);
  const plannedTotal = budgetLines.reduce((sum, line) => sum + line.planned, 0);
  const fallbackSummary = buildFallbackTicketMonthSummary(tickets);
  const currentRemaining =
    summary?.currentRemaining ?? fallbackSummary.currentRemaining ?? ticketsFinancePreset.monthlyIncome - total;
  const theoreticalRemaining =
    summary?.theoreticalRemaining ??
    fallbackSummary.theoreticalRemaining ??
    ticketsFinancePreset.monthlyIncome - plannedTotal;
  const unexpectedSpend =
    summary?.unexpectedSpendTotal ?? currentRemaining - theoreticalRemaining;
  const largestTicket =
    [...tickets].sort((left, right) => right.amount - left.amount)[0] ?? null;

  return {
    total,
    ticketCount: tickets.length,
    sentCount,
    pendingCount,
    sentRatio: tickets.length > 0 ? (sentCount / tickets.length) * 100 : 0,
    averageTicket,
    budgetLines,
    plannedTotal,
    currentRemaining,
    theoreticalRemaining,
    unexpectedSpend,
    largestTicket,
    budgetUsagePercent:
      ticketsFinancePreset.monthlyIncome > 0
        ? Math.min(100, (total / ticketsFinancePreset.monthlyIncome) * 100)
        : 0,
  };
}

function buildTicketCategoryMap(tickets: Ticket[]) {
  const totals = new Map<string, { amount: number; count: number }>();

  tickets.forEach((ticket) => {
    const key = ticket.category.trim() || "Sans categorie";
    const current = totals.get(key) ?? { amount: 0, count: 0 };
    totals.set(key, {
      amount: current.amount + ticket.amount,
      count: current.count + 1,
    });
  });

  return totals;
}

function buildCategoryCompareRows(
  primaryTickets: Ticket[],
  secondaryTickets: Ticket[],
  sortMode: CompareSortMode
) {
  const primaryMap = buildTicketCategoryMap(primaryTickets);
  const secondaryMap = buildTicketCategoryMap(secondaryTickets);
  const categories = new Set([...primaryMap.keys(), ...secondaryMap.keys()]);

  const rows = [...categories]
    .map((category) => {
      const primary = primaryMap.get(category) ?? { amount: 0, count: 0 };
      const secondary = secondaryMap.get(category) ?? { amount: 0, count: 0 };
      const delta = primary.amount - secondary.amount;

      return {
        category,
        primaryAmount: primary.amount,
        secondaryAmount: secondary.amount,
        primaryCount: primary.count,
        secondaryCount: secondary.count,
        delta,
        absoluteDelta: Math.abs(delta),
      };
    })
    .filter((row) => row.primaryAmount > 0.009 || row.secondaryAmount > 0.009);

  rows.sort((left, right) => {
    if (sortMode === "primary") {
      return (
        right.primaryAmount - left.primaryAmount ||
        right.absoluteDelta - left.absoluteDelta ||
        left.category.localeCompare(right.category, "fr")
      );
    }

    if (sortMode === "secondary") {
      return (
        right.secondaryAmount - left.secondaryAmount ||
        right.absoluteDelta - left.absoluteDelta ||
        left.category.localeCompare(right.category, "fr")
      );
    }

    return (
      right.absoluteDelta - left.absoluteDelta ||
      right.primaryAmount - left.primaryAmount ||
      left.category.localeCompare(right.category, "fr")
    );
  });

  return rows;
}

function buildUnexpectedSpendTickets(tickets: Ticket[]): UnexpectedSpendTicket[] {
  const categoryOrder = new Map<string, number>(
    unexpectedSpendSheetCategories.map((category, index) => [category, index])
  );

  return tickets
    .filter((ticket) => categoryOrder.has(ticket.category))
    .map((ticket) => ({
      ticket,
      reason: "Categorie non prevue du sheet",
    }))
    .sort((left, right) => {
      const categoryDelta =
        (categoryOrder.get(left.ticket.category) ?? 999) -
        (categoryOrder.get(right.ticket.category) ?? 999);

      if (categoryDelta !== 0) {
        return categoryDelta;
      }

      const dateDelta = getTicketDateValue(right.ticket) - getTicketDateValue(left.ticket);
      if (dateDelta !== 0) {
        return dateDelta;
      }

      return right.ticket.amount - left.ticket.amount;
    });
}

function buildUnexpectedSpendCategoryTotals(tickets: Ticket[]) {
  const totals = new Map<string, { category: string; total: number; count: number }>();

  unexpectedSpendSheetCategories.forEach((category) => {
    totals.set(category, { category, total: 0, count: 0 });
  });

  tickets.forEach((ticket) => {
    if (!totals.has(ticket.category)) {
      return;
    }

    const current = totals.get(ticket.category)!;
    current.total += ticket.amount;
    current.count += 1;
  });

  return unexpectedSpendSheetCategories
    .map((category) => totals.get(category)!)
    .filter((entry) => entry.total > 0.009);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAuditSeverityRank(severity: AuditSeverity) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function normalizeAuditDescription(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(cb|carte|visa|mastercard|paiement|payment|facture|prelevement|prlv|achat|transaction)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isCloseAmount(left: number, right: number, tolerance: number) {
  return Math.abs(left - right) <= tolerance;
}

function getGroupDateSpreadInDays(tickets: Ticket[]) {
  const dates = tickets
    .map((ticket) => getTicketDateValue(ticket))
    .filter((value) => value > 0);

  if (dates.length < 2) {
    return 0;
  }

  return Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000);
}

function dedupeAuditFlaggedTickets(items: AuditFlaggedTicket[]) {
  const byTicket = new Map<string, AuditFlaggedTicket>();

  items.forEach((item) => {
    const existing = byTicket.get(item.key);

    if (!existing || getAuditSeverityRank(item.severity) > getAuditSeverityRank(existing.severity)) {
      byTicket.set(item.key, item);
    }
  });

  return [...byTicket.values()].sort((left, right) => {
    const severityDelta =
      getAuditSeverityRank(right.severity) - getAuditSeverityRank(left.severity);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.ticket.amount - left.ticket.amount;
  });
}

function buildAuditRecurringIndex(tickets: Ticket[]) {
  const index = new Map<
    string,
    {
      label: string;
      category: string;
      totalAmount: number;
      count: number;
    }
  >();

  tickets.forEach((ticket) => {
    const rawLabel = ticket.description.trim() || ticket.category.trim() || "Sans libelle";
    const key = normalizeAuditDescription(rawLabel);

    if (!key) {
      return;
    }

    const current = index.get(key) ?? {
      label: rawLabel,
      category: ticket.category || "Sans categorie",
      totalAmount: 0,
      count: 0,
    };

    index.set(key, {
      label: current.label.length >= rawLabel.length ? current.label : rawLabel,
      category: current.category || ticket.category || "Sans categorie",
      totalAmount: current.totalAmount + ticket.amount,
      count: current.count + 1,
    });
  });

  return index;
}

function buildAuditReport(
  currentTickets: Ticket[],
  currentSummary: TicketMonthSummary | null,
  referenceTickets: Ticket[],
  subscriptions: DashboardSubscription[]
): AuditReport {
  const alerts: AuditAlert[] = [];
  const flaggedTickets: AuditFlaggedTicket[] = [];
  const currentMetrics = buildCompareMonthMetrics(currentTickets, currentSummary);
  const categoryDeltas = buildCategoryCompareRows(currentTickets, referenceTickets, "delta").map(
    (row) => ({
      category: row.category,
      currentAmount: row.primaryAmount,
      referenceAmount: row.secondaryAmount,
      delta: row.delta,
      currentCount: row.primaryCount,
      referenceCount: row.secondaryCount,
    })
  );

  const outlierThreshold = Math.max(95, currentMetrics.averageTicket * 1.9);
  const criticalOutlierThreshold = Math.max(180, currentMetrics.averageTicket * 2.6);
  const outliers = [...currentTickets]
    .filter((ticket) => ticket.amount >= outlierThreshold)
    .sort((left, right) => right.amount - left.amount);

  if (outliers.length > 0) {
    const topOutlier = outliers[0];
    const severity: AuditSeverity =
      topOutlier.amount >= criticalOutlierThreshold ? "critical" : "warning";

    alerts.push({
      id: "outliers",
      severity,
      icon: severity === "critical" ? "!!" : "!",
      title:
        outliers.length === 1
          ? "Ticket inhabituel detecte"
          : `${outliers.length} tickets inhabituels`,
      detail: `${topOutlier.description || "Sans description"} ressort a ${euro.format(topOutlier.amount)} pour un ticket moyen de ${euro.format(currentMetrics.averageTicket || 0)}.`,
      amount: outliers.reduce((sum, ticket) => sum + ticket.amount, 0),
    });

    outliers.slice(0, 4).forEach((ticket) => {
      flaggedTickets.push({
        key: getTicketKey(ticket),
        ticket,
        severity,
        reason: `Montant bien au-dessus du ticket moyen (${euro.format(currentMetrics.averageTicket || 0)}).`,
      });
    });
  }

  const duplicateGroups = [...currentTickets.reduce((map, ticket) => {
    const normalizedLabel = normalizeAuditDescription(
      ticket.description || ticket.category || "Sans libelle"
    );

    if (!normalizedLabel || normalizedLabel.length < 3) {
      return map;
    }

    const key = `${normalizedLabel}__${ticket.amount.toFixed(2)}`;
    const current = map.get(key) ?? [];
    current.push(ticket);
    map.set(key, current);
    return map;
  }, new Map<string, Ticket[]>()).values()]
    .filter((group) => group.length > 1 && getGroupDateSpreadInDays(group) <= 10)
    .sort((left, right) => right.length - left.length || right[0].amount - left[0].amount);

  if (duplicateGroups.length > 0) {
    const firstGroup = duplicateGroups[0];
    const groupAmount = firstGroup.reduce((sum, ticket) => sum + ticket.amount, 0);

    alerts.push({
      id: "duplicates",
      severity: duplicateGroups.length > 1 || firstGroup.length > 2 ? "critical" : "warning",
      icon: "x2",
      title:
        duplicateGroups.length > 1
          ? `${duplicateGroups.length} groupes de doublons probables`
          : "Doublon probable a verifier",
      detail: `${firstGroup[0]?.description || "Sans description"} revient ${firstGroup.length} fois sur une courte periode pour ${euro.format(firstGroup[0]?.amount ?? 0)}.`,
      amount: groupAmount,
    });

    duplicateGroups.slice(0, 2).forEach((group) => {
      group.forEach((ticket) => {
        flaggedTickets.push({
          key: getTicketKey(ticket),
          ticket,
          severity: "critical",
          reason: "Description et montant repetes sur une courte fenetre.",
        });
      });
    });
  }

  const topCategorySpike = categoryDeltas.find(
    (row) => row.delta > Math.max(45, row.referenceAmount * 0.4)
  );
  const topCategoryRelief = categoryDeltas.find(
    (row) => row.delta < -Math.max(35, row.referenceAmount * 0.35)
  );

  if (topCategorySpike) {
    alerts.push({
      id: "category-spike",
      severity: topCategorySpike.delta > 110 ? "critical" : "warning",
      icon: "UP",
      title: `${topCategorySpike.category} tire le mois vers le haut`,
      detail: `${formatBudgetDifference(topCategorySpike.delta)} par rapport a la periode de reference.`,
      amount: topCategorySpike.currentAmount,
    });
  }

  if (topCategoryRelief) {
    alerts.push({
      id: "category-relief",
      severity: "ok",
      icon: "OK",
      title: `${topCategoryRelief.category} respire mieux`,
      detail: `${formatBudgetDifference(Math.abs(topCategoryRelief.delta))} economises sur cette categorie.`,
      amount: topCategoryRelief.currentAmount,
    });
  }

  if (currentMetrics.unexpectedSpend > 25) {
    alerts.push({
      id: "unexpected-spend",
      severity: currentMetrics.unexpectedSpend > 95 ? "critical" : "warning",
      icon: "EUR",
      title: "Depense non prevue au-dessus du rythme cible",
      detail: `Le reel depasse le theorique de ${formatBudgetDifference(currentMetrics.unexpectedSpend)} sur ce mois.`,
      amount: currentMetrics.unexpectedSpend,
    });
  }

  if (currentMetrics.pendingCount >= 4 || currentMetrics.sentRatio < 60) {
    alerts.push({
      id: "pending",
      severity: currentMetrics.pendingCount >= 7 ? "critical" : "warning",
      icon: "CLK",
      title: "Archivage des tickets a reprendre",
      detail: `${currentMetrics.pendingCount} ticket(s) restent en attente, soit ${Math.round(currentMetrics.sentRatio)}% seulement de tickets envoyes.`,
    });
  }

  const currentRecurringIndex = buildAuditRecurringIndex(currentTickets);
  const referenceRecurringIndex = buildAuditRecurringIndex(referenceTickets);

  const recurringCandidates = [...currentRecurringIndex.entries()]
    .map(([key, currentValue]) => {
      const referenceValue = referenceRecurringIndex.get(key);

      if (!referenceValue) {
        return null;
      }

      const currentAverage = currentValue.totalAmount / currentValue.count;
      const referenceAverage = referenceValue.totalAmount / referenceValue.count;
      const tolerance = Math.max(3, referenceAverage * 0.18);

      if (!isCloseAmount(currentAverage, referenceAverage, tolerance)) {
        return null;
      }

      const trackedSubscription =
        subscriptions.find((subscription) => {
          const normalizedSubscription = normalizeAuditDescription(subscription.label);

          if (!normalizedSubscription) {
            return false;
          }

          return (
            (key.includes(normalizedSubscription) || normalizedSubscription.includes(key)) &&
            isCloseAmount(currentAverage, subscription.amount, Math.max(2.5, subscription.amount * 0.18))
          );
        }) ?? null;

      return {
        key,
        label: currentValue.label,
        category: currentValue.category || referenceValue.category || "Sans categorie",
        currentAmount: currentAverage,
        referenceAmount: referenceAverage,
        delta: currentAverage - referenceAverage,
        currentCount: currentValue.count,
        referenceCount: referenceValue.count,
        tracked: Boolean(trackedSubscription),
        trackedLabel: trackedSubscription?.label ?? "",
      } satisfies AuditRecurringCandidate;
    })
    .filter((item): item is AuditRecurringCandidate => item !== null)
    .sort((left, right) => {
      if (left.tracked !== right.tracked) {
        return Number(left.tracked) - Number(right.tracked);
      }

      return right.currentAmount - left.currentAmount;
    });

  const untrackedRecurring = recurringCandidates.filter((item) => !item.tracked);

  if (untrackedRecurring.length > 0) {
    const firstRecurring = untrackedRecurring[0];

    alerts.push({
      id: "recurring",
      severity: untrackedRecurring.length > 2 ? "warning" : "ok",
      icon: "LOOP",
      title:
        untrackedRecurring.length > 1
          ? `${untrackedRecurring.length} depenses recurrentes a cadrer`
          : "Depense recurrente a suivre",
      detail: `${firstRecurring.label} revient aussi sur la periode de reference sans etre rattache a un abonnement suivi.`,
      amount: firstRecurring.currentAmount,
    });
  }

  const dedupedFlaggedTickets = dedupeAuditFlaggedTickets(flaggedTickets);
  const underWatchTotal = dedupedFlaggedTickets.reduce(
    (sum, item) => sum + item.ticket.amount,
    0
  );

  alerts.sort((left, right) => {
    const severityDelta =
      getAuditSeverityRank(right.severity) - getAuditSeverityRank(left.severity);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return (right.amount ?? 0) - (left.amount ?? 0);
  });

  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;
  const okCount = alerts.filter((alert) => alert.severity === "ok").length;
  const duplicateGroupCount = duplicateGroups.length;
  const outlierCount = outliers.length;
  const untrackedRecurringCount = untrackedRecurring.length;

  let score = 100;
  score -= criticalCount * 18;
  score -= warningCount * 9;
  score -= Math.min(22, Math.max(0, currentMetrics.unexpectedSpend) / 12);
  score -= Math.min(12, currentMetrics.pendingCount * 1.5);
  score -= Math.min(10, duplicateGroupCount * 4);
  score -= Math.min(10, untrackedRecurringCount * 3);
  score += Math.min(6, okCount * 2);
  score = clampNumber(Math.round(score), 18, 100);

  const statusTone: AuditSeverity =
    score >= 82 ? "ok" : score >= 60 ? "warning" : "critical";
  const statusLabel =
    statusTone === "ok"
      ? "Mois sain"
      : statusTone === "warning"
        ? "A surveiller"
        : "Sous tension";

  if (alerts.length === 0) {
    alerts.push({
      id: "clean",
      severity: "ok",
      icon: "OK",
      title: "Aucune alerte majeure",
      detail: "Le mois reste propre pour le moment, sans signal evident a escalader.",
    });
  }

  return {
    score,
    statusLabel,
    statusTone,
    alerts,
    flaggedTickets: dedupedFlaggedTickets,
    recurringCandidates,
    categoryDeltas,
    underWatchTotal,
    criticalCount,
    warningCount,
    okCount,
    duplicateGroupCount,
    outlierCount,
    untrackedRecurringCount,
  };
}

function renderMonthFilter(selectedMonth: string, onMonthChange: (month: string) => void, loading = false) {
  return (
    <div className="month-filter-block">
      <div className="month-filter-head">
        <span className="month-filter-kicker">Periode</span>
        <strong>{getSelectedMonthLabel(selectedMonth)}</strong>
      </div>
      <div className="month-pill-row">
        {monthOptions.map((month) => (
          <button
            key={month.value}
            type="button"
            className={`month-pill ${selectedMonth === month.value ? "active" : ""} ${selectedMonth === month.value && loading ? "loading" : ""}`}
            onClick={() => onMonthChange(month.value)}
          >
            {month.label.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

function renderTicketModal(
  form: NewTicketForm,
  submitting: boolean,
  submitError: string,
  voiceSupported: boolean,
  voiceListening: boolean,
  voiceTranscript: string,
  voiceStep: VoiceStep,
  voiceFeedback: string,
  selectedMonth: string,
  categoryPromptOpen: boolean,
  followUpPrompt: TicketFollowUpPrompt | null,
  onClose: () => void,
  onSubmit: () => void,
  onAnotherTicketChoice: (wantsAnotherTicket: boolean) => void,
  onChange: (patch: Partial<NewTicketForm>) => void,
  onToggleVoice: () => void
) {
  const detectedCategory = inferCategoryFromDescription(form.description);
  const hasAutoCategory = Boolean(detectedCategory);
  const formComplete = Boolean(form.date && form.amount && form.description.trim());
  const isFollowUpMode = Boolean(followUpPrompt);

  const handleDescriptionChange = (value: string) => {
    const detected = inferCategoryFromDescription(value);
    if (detected) {
      onChange({ description: value, category: detected });
    } else {
      onChange({ description: value });
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="ntm-shell">

        <div className="ntm-header">
          <div className="ntm-header-left">
            <span className="ntm-badge">{isFollowUpMode ? "Ticket enregistre" : "Nouveau ticket"}</span>
            <h2 className="ntm-title">
              {isFollowUpMode ? "Ajouter un autre ticket ?" : "Ajouter une depense"}
              <span className="ntm-title-month">
                {getSelectedMonthLabel(selectedMonth)}
              </span>
            </h2>
          </div>
          <button type="button" className="ntm-close" onClick={onClose} disabled={submitting}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="ntm-body">
          {isFollowUpMode ? (
            <div className="ntm-followup">
              <div className="ntm-followup-card">
                <span className="ntm-followup-kicker">Confirmation</span>
                <strong>Ticket ajoute avec succes.</strong>
                <p>
                  Veux-tu ajouter un autre ticket ?
                  {followUpPrompt?.keepDate ? ` La date ${followUpPrompt.keepDate} sera conservee.` : ""}
                </p>
              </div>

              <div className="ntm-voice-section">
                <div className="ntm-voice-head">
                  <div className="ntm-voice-head-left">
                    <span className="ntm-voice-icon">{voiceListening ? "●" : "🎤"}</span>
                    <div>
                      <strong className="ntm-voice-title">Assistant vocal</strong>
                      <span className="ntm-voice-sub">Reponds oui ou non pour continuer</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`ntm-voice-btn ${voiceListening ? "listening" : ""}`}
                    onClick={onToggleVoice}
                    disabled={!voiceSupported}
                  >
                    {voiceListening ? "Arreter" : "Dicter"}
                  </button>
                </div>

                {(voiceListening || voiceTranscript) && (
                  <div className="ntm-voice-live">
                    <div className="ntm-voice-prompt">
                      <span className="ntm-voice-prompt-label">Question</span>
                      <p className="ntm-voice-prompt-text">{getAnotherTicketVoicePrompt()}</p>
                    </div>

                    <div className={`ntm-voice-transcript ${voiceTranscript ? "has-text" : ""}`}>
                      <span className="ntm-voice-wave">
                        <span /><span /><span /><span /><span />
                      </span>
                      <span>{voiceTranscript || "En attente de votre voix..."}</span>
                    </div>
                  </div>
                )}

                {voiceFeedback && (
                  <div className="ntm-voice-feedback">{voiceFeedback}</div>
                )}

                {!voiceSupported && (
                  <div className="ntm-voice-unavailable">
                    La dictee vocale n est pas disponible sur ce navigateur.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="ntm-form-section">

                <div className="ntm-row-2">
                  <label className="ntm-field">
                    <span className="ntm-label">Date</span>
                    <div className="ntm-input-wrap">
                      <input
                        className="ntm-input"
                        type="date"
                        value={form.date}
                        onChange={(e) => onChange({ date: e.target.value })}
                      />
                    </div>
                  </label>

                  <label className="ntm-field">
                    <span className="ntm-label">Montant</span>
                    <div className="ntm-input-wrap ntm-input-wrap-euro">
                      <input
                        className="ntm-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={form.amount}
                        onChange={(e) => onChange({ amount: e.target.value })}
                      />
                      <span className="ntm-input-suffix">€</span>
                    </div>
                  </label>
                </div>

                <label className="ntm-field">
                  <span className="ntm-label">Description</span>
                  <div className="ntm-input-wrap ntm-input-wrap-description">
                    <input
                      className="ntm-input"
                      type="text"
                      placeholder="Ex: Carrefour, Netflix, Garage..."
                      value={form.description}
                      onChange={(e) => handleDescriptionChange(e.target.value)}
                      autoFocus
                    />
                    {hasAutoCategory && (
                      <span className="ntm-auto-badge" title="Categorie detectee automatiquement">
                        {detectedCategory}
                      </span>
                    )}
                  </div>
                  {hasAutoCategory && (
                    <span className="ntm-auto-hint">Categorie detectee automatiquement d apres la description</span>
                  )}
                </label>

                <label className="ntm-field">
                  <span className="ntm-label">Categorie</span>
                  <select
                    className="ntm-input ntm-select"
                    value={form.category}
                    onChange={(e) => onChange({ category: e.target.value })}
                  >
                    <option value="">Sans categorie</option>
                    {SHEET_ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </label>
              </div>

              {categoryPromptOpen && !form.category && (
                <div className="ntm-category-popup">
                  <div className="ntm-category-popup-head">
                    <strong>Categorie non detectee</strong>
                    <span>Choisis-la pour terminer le ticket.</span>
                  </div>
                  <select
                    className="ntm-input ntm-select ntm-category-popup-select"
                    value={form.category}
                    onChange={(e) => onChange({ category: e.target.value })}
                  >
                    <option value="">-- Choisir une categorie --</option>
                    {SHEET_ALL_CATEGORIES.map((cat) => (
                      <option key={`popup-${cat}`} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ntm-voice-section">
                <div className="ntm-voice-head">
                  <div className="ntm-voice-head-left">
                    <span className="ntm-voice-icon">{voiceListening ? "●" : "🎤"}</span>
                    <div>
                      <strong className="ntm-voice-title">Assistant vocal</strong>
                      <span className="ntm-voice-sub">Dictee intelligente guidee</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`ntm-voice-btn ${voiceListening ? "listening" : ""}`}
                    onClick={onToggleVoice}
                    disabled={!voiceSupported}
                  >
                    {voiceListening ? "Arreter" : "Dicter"}
                  </button>
                </div>

                {voiceListening && (
                  <div className="ntm-voice-live">
                    <div className="ntm-voice-step-row">
                      {(["date", "amount", "description", "confirm"] as VoiceStep[]).map((step, i) => {
                        const state = getVoiceStepState(step, voiceStep, form);
                        return (
                          <div className={`ntm-voice-step ${state}`} key={step}>
                            <span className="ntm-voice-step-num">{i + 1}</span>
                            <span className="ntm-voice-step-label">{getVoiceStepLabel(step)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="ntm-voice-prompt">
                      <span className="ntm-voice-prompt-label">Etape: {getVoiceStepLabel(voiceStep)}</span>
                      <p className="ntm-voice-prompt-text">{getVoiceStepPrompt(voiceStep, form)}</p>
                    </div>

                    <div className={`ntm-voice-transcript ${voiceTranscript ? "has-text" : ""}`}>
                      <span className="ntm-voice-wave">
                        <span /><span /><span /><span /><span />
                      </span>
                      <span>{voiceTranscript || "En attente de votre voix..."}</span>
                    </div>
                  </div>
                )}

                {voiceFeedback && (
                  <div className="ntm-voice-feedback">{voiceFeedback}</div>
                )}

                {!voiceSupported && (
                  <div className="ntm-voice-unavailable">
                    La dictee vocale n est pas disponible sur ce navigateur.
                  </div>
                )}
              </div>

              {formComplete && (
                <div className="ntm-recap">
                  <span className="ntm-recap-label">Recap du ticket</span>
                  <div className="ntm-recap-grid">
                    <div className="ntm-recap-item">
                      <span>Date</span>
                      <strong>{form.date}</strong>
                    </div>
                    <div className="ntm-recap-item">
                      <span>Montant</span>
                      <strong>{form.amount} €</strong>
                    </div>
                    <div className="ntm-recap-item ntm-recap-wide">
                      <span>Description</span>
                      <strong>{form.description}</strong>
                    </div>
                    <div className="ntm-recap-item ntm-recap-wide">
                      <span>Categorie</span>
                      <strong>{form.category || "Aucune"}</strong>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {submitError && <div className="ntm-error">{submitError}</div>}

        <div className="ntm-footer">
          {isFollowUpMode ? (
            <>
              <button type="button" className="ntm-cancel" onClick={() => onAnotherTicketChoice(false)}>
                Non
              </button>
              <button
                type="button"
                className="ntm-submit ready"
                onClick={() => onAnotherTicketChoice(true)}
              >
                Oui, un autre ticket
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ntm-cancel" onClick={onClose} disabled={submitting}>
                Annuler
              </button>
              <button
                type="button"
                className={`ntm-submit ${formComplete ? "ready" : ""}`}
                onClick={onSubmit}
                disabled={submitting || !formComplete}
              >
                {submitting ? (
                  <span className="ntm-submit-loading">
                    <span className="ntm-spinner" />
                    Envoi en cours...
                  </span>
                ) : (
                  "Enregistrer le ticket"
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderCsvImportModal(
  open: boolean,
  fileName: string,
  targetMonth: string,
  currentViewMonth: string,
  summary: CsvImportSummary,
  drafts: CsvImportDraft[],
  session: SharedCsvImportSession | null,
  busy: boolean,
  submitting: boolean,
  error: string,
  status: string,
  onClose: () => void,
  onPickAnotherFile: () => void,
  onSelectAll: (include: boolean) => void,
  onDraftIncludeChange: (id: string, include: boolean) => void,
  onDraftChange: (
    id: string,
    patch: Partial<Pick<CsvImportDraft, "date" | "amount" | "description" | "category">>
  ) => void,
  onImport: () => void
) {
  if (!open) {
    return null;
  }

  const selectedCount = drafts.filter((draft) => draft.include).length;
  const blockedCount = drafts.length - selectedCount;
  const missingCategoryCount = drafts.filter(
    (draft) => draft.include && !draft.category.trim()
  ).length;
  const targetMonthLabel = getSelectedMonthLabel(targetMonth);
  const currentViewMonthLabel = getSelectedMonthLabel(currentViewMonth);
  const monthMismatch = targetMonth !== currentViewMonth;
  const participants = session?.participants ?? [];
  const ownerName = session?.ownerName?.trim() || "Une session";
  const sessionSubmittingByName = session?.submittingByName?.trim() || "";
  const controlsLocked = busy || submitting || Boolean(sessionSubmittingByName);
  const submitLabel = sessionSubmittingByName
    ? `${sessionSubmittingByName} importe...`
    : submitting
      ? "Import en cours..."
      : `Importer ${selectedCount} ticket(s)`;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !controlsLocked) {
          onClose();
        }
      }}
    >
      <div className="csv-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="csv-import-head">
          <div className="csv-import-head-copy">
            <span className="panel-kicker">Import Revolut CSV</span>
            <h2>Verifier avant import sur {targetMonthLabel.toLowerCase()}</h2>
            <p>
              L app ne propose que les nouvelles depenses du mois detecte dans le CSV.
              Tu peux ensuite ajuster categorie, libelle, date ou montant avant validation.
            </p>
          </div>

          <div className="csv-import-head-side">
            <div className="csv-import-presence-card">
              <div className="csv-import-presence-head">
                <span className="csv-import-presence-kicker">Import partage</span>
                <span className="csv-import-file-chip">{fileName || "Fichier CSV"}</span>
              </div>
              <strong>{sessionSubmittingByName || ownerName}</strong>
              <p>
                {sessionSubmittingByName
                  ? `${sessionSubmittingByName} est en train d envoyer les tickets.`
                  : participants.length > 1
                    ? `${participants.length} participant(s) relisent ce lot ensemble.`
                    : "Session ouverte. Tu peux relire et ajuster les lignes avant import."}
              </p>
              {participants.length > 0 ? (
                <div className="csv-import-participants">
                  {participants.map((participant) => (
                    <span key={participant.id} className="csv-import-participant-chip">
                      <span
                        className="csv-import-participant-dot"
                        style={{ backgroundColor: participant.color }}
                      />
                      {participant.name || "Session"}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="csv-import-head-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={onPickAnotherFile}
                disabled={controlsLocked}
              >
                Autre CSV
              </button>
              <button
                type="button"
                className="modal-close"
                onClick={onClose}
                disabled={Boolean(sessionSubmittingByName)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>

        <div className="csv-import-summary">
          <div className="csv-import-tile">
            <span>Mois cible</span>
            <strong>{targetMonthLabel}</strong>
          </div>
          <div className="csv-import-tile">
            <span>Lignes du fichier</span>
            <strong>{summary.totalRows}</strong>
          </div>
          <div className="csv-import-tile">
            <span>Proposees</span>
            <strong>{drafts.length}</strong>
          </div>
          <div className="csv-import-tile">
            <span>Preselectionnees</span>
            <strong>{selectedCount}</strong>
          </div>
          <div className="csv-import-tile">
            <span>Ignorees auto</span>
            <strong>{summary.hardSkippedRows}</strong>
          </div>
        </div>

        {monthMismatch ? (
          <div className="status info csv-import-banner">
            Ce CSV sera importe dans {targetMonthLabel}. Vue actuelle: {currentViewMonthLabel}.
          </div>
        ) : null}

        {summary.ignoredByReason.length > 0 ? (
          <div className="csv-import-ignored-list">
            {summary.ignoredByReason.map((item) => (
              <span key={`${item.label}-${item.count}`} className="csv-import-note">
                {item.label} x{item.count}
              </span>
            ))}
          </div>
        ) : null}

        {status ? <div className="status ok csv-import-banner">{status}</div> : null}
        {error ? <div className="status warn csv-import-banner">{error}</div> : null}

        <div className="csv-import-toolbar">
          <div className="csv-import-toolbar-copy">
            <strong>{selectedCount} ticket(s) prets a importer</strong>
            <span>
              {sessionSubmittingByName
                ? `${sessionSubmittingByName} finalise l import en ce moment`
                : missingCategoryCount > 0
                ? `${missingCategoryCount} categorie(s) a confirmer`
                : blockedCount > 0
                  ? `${blockedCount} ligne(s) actuellement sur non`
                  : "Tout est pret"}
            </span>
          </div>
          <div className="csv-import-toolbar-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onSelectAll(true)}
              disabled={controlsLocked || drafts.length === 0}
            >
              Tout cocher
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onSelectAll(false)}
              disabled={controlsLocked || drafts.length === 0}
            >
              Tout decocher
            </button>
          </div>
        </div>

        <div className="csv-import-body">
          {drafts.length > 0 ? (
            <div className="csv-import-list">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`csv-import-row ${draft.include ? "" : "excluded"} ${draft.error ? "has-error" : ""}`}
                >
                  <div className="csv-import-row-head">
                    <div className="csv-import-row-title">
                      <strong>{draft.description || "Sans description"}</strong>
                      <span>
                        Ligne CSV {draft.sourceRow} • {draft.sourceType || "Operation"}
                      </span>
                    </div>

                    <div className="csv-import-toggle">
                      <button
                        type="button"
                        className={`csv-import-toggle-btn yes ${draft.include ? "active" : ""}`}
                        onClick={() => onDraftIncludeChange(draft.id, true)}
                        disabled={controlsLocked}
                      >
                        Oui
                      </button>
                      <button
                        type="button"
                        className={`csv-import-toggle-btn no ${!draft.include ? "active" : ""}`}
                        onClick={() => onDraftIncludeChange(draft.id, false)}
                        disabled={controlsLocked}
                      >
                        Non
                      </button>
                    </div>
                  </div>

                  <div className="csv-import-row-main">
                    <div className="csv-import-row-meta">
                      <label className="csv-import-field">
                        <span>Date</span>
                        <input
                          className="field-input"
                          type="date"
                          value={draft.date}
                          onChange={(event) => onDraftChange(draft.id, { date: event.target.value })}
                          disabled={controlsLocked}
                        />
                      </label>

                      <label className="csv-import-field">
                        <span>Montant</span>
                        <input
                          className="field-input"
                          type="text"
                          inputMode="decimal"
                          value={draft.amount}
                          onChange={(event) => onDraftChange(draft.id, { amount: event.target.value })}
                          disabled={controlsLocked}
                        />
                      </label>
                    </div>

                    <div className="csv-import-row-grid">
                      <label className="csv-import-field csv-import-field-wide">
                        <span>Description</span>
                        <input
                          className="field-input"
                          type="text"
                          value={draft.description}
                          onChange={(event) =>
                            onDraftChange(draft.id, { description: event.target.value })
                          }
                          disabled={controlsLocked}
                        />
                      </label>

                      <label className="csv-import-field csv-import-field-wide">
                        <span>Categorie</span>
                        <select
                          className="field-input"
                          value={draft.category}
                          onChange={(event) => onDraftChange(draft.id, { category: event.target.value })}
                          disabled={controlsLocked}
                        >
                          <option value="">A confirmer</option>
                          {SHEET_ALL_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="csv-import-row-notes">
                    {draft.note ? <span className="csv-import-note warn">{draft.note}</span> : null}
                    {!draft.category.trim() ? (
                      <span className="csv-import-note neutral">Categorie a confirmer</span>
                    ) : null}
                    {draft.include ? (
                      <span className="csv-import-note ok">Importe en attente</span>
                    ) : null}
                  </div>

                  {draft.error ? <div className="csv-import-row-error">{draft.error}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="csv-import-empty">
              <strong>Aucune ligne importable dans ce fichier.</strong>
              <p>
                Le CSV a ete lu, mais aucune depense negative terminee
                ne correspond au mois selectionne.
              </p>
            </div>
          )}
        </div>

        <div className="csv-import-foot">
          <span>Les tickets importes seront crees avec `sent = false`.</span>
          <div className="ticket-modal-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={onClose}
              disabled={Boolean(sessionSubmittingByName)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onImport}
              disabled={controlsLocked || selectedCount === 0}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderDashboard(
  tickets: Ticket[],
  monthSummary: TicketMonthSummary | null,
  loading: boolean,
  refreshing: boolean,
  error: string,
  selectedMonth: string,
  lastSyncAt: number | null,
  reimbursementTotal: number,
  subscriptions: DashboardSubscription[],
  subPanelOpen: boolean,
  subFormLabel: string,
  subFormAmount: string,
  subFormError: string,
  onMonthChange: (month: string) => void,
  onRefreshTickets: () => void,
  csvImportBusy: boolean,
  onOpenTicketModal: () => void,
  onOpenCsvImportModal: () => void,
  onToggleSubPanel: () => void,
  onToggleSubDeletePanel: () => void,
  onSubFormLabelChange: (v: string) => void,
  onSubFormAmountChange: (v: string) => void,
  onAddSubscription: () => void,
  onDeleteSubscription: (id: string) => void,
  subDeletePanelOpen: boolean,
  unexpectedSpendModalOpen: boolean,
  onOpenUnexpectedSpendModal: () => void,
  onCloseUnexpectedSpendModal: () => void
) {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const sentCount = tickets.filter((ticket) => ticket.sent).length;
  const pendingCount = tickets.length - sentCount;
  const recentTickets = tickets.slice(-6).reverse();
  const isBusy = loading || refreshing;

  const monthlyIncome = ticketsFinancePreset.monthlyIncome;
  const budgetLines = computeTicketBudgetLines(tickets);
  const budgetPlannedTotal = budgetLines.reduce((sum, line) => sum + line.planned, 0);
  const currentBalance = monthlyIncome - monthlyTotal;
  const accountBalanceValue = monthSummary?.accountBalance ?? null;
  const currentRemainingValue = monthSummary?.currentRemaining ?? currentBalance;
  const theoreticalRemainingValue =
    monthSummary?.theoreticalRemaining ?? monthlyIncome - budgetPlannedTotal;
  const unexpectedSpendTotalValue =
    monthSummary?.unexpectedSpendTotal ??
    (currentRemainingValue !== null && theoreticalRemainingValue !== null
      ? currentRemainingValue - theoreticalRemainingValue
      : null);
  const unexpectedSpendTone =
    unexpectedSpendTotalValue !== null
      ? getBudgetDifferenceTone(unexpectedSpendTotalValue)
      : "neutral";
  const unexpectedSpendTickets = buildUnexpectedSpendTickets(tickets);
  const unexpectedSpendCategoryTotals = buildUnexpectedSpendCategoryTotals(tickets);
  const unexpectedSpendCategoryTotalValue = unexpectedSpendCategoryTotals.reduce(
    (sum, item) => sum + item.total,
    0
  );
  const sentRatio = tickets.length > 0 ? Math.round((sentCount / tickets.length) * 100) : 0;
  const totalWithReimbursements = monthlyTotal + reimbursementTotal;

  const dashboardStatus = loading
    ? "Chargement des donnees..."
    : error
      ? "Connexion Google Sheets a verifier"
      : lastSyncAt
        ? (
            <>
              Google Sheets OK • <LiveRelativeSyncLabel syncedAt={lastSyncAt} />
            </>
          )
        : "Google Sheets OK • donnees chargees";

  const archiveToneClass = pendingCount === 0 || sentRatio >= 70 ? "ok" : "warn";

  const subTotal = subscriptions.reduce((s, item) => s + item.amount, 0);

  return (
    <>
      <section className="panel dashboard-v3-top-panel">
        <div className="dashboard-v3-top-grid">
          <div className="dashboard-v3-left">
            <h1>Budget mensuel</h1>
            <div className="dashboard-v3-actions">
              <button className="primary-btn" onClick={onOpenTicketModal}>
                Nouvelle depense
              </button>
              <button
                className="ghost-btn"
                onClick={onOpenCsvImportModal}
                disabled={csvImportBusy}
              >
                {csvImportBusy ? "Analyse CSV..." : "Importer CSV"}
              </button>
              <button className="outline-btn" onClick={onRefreshTickets}>
                {isBusy ? "Actualisation..." : "Actualiser"}
              </button>
            </div>
          </div>

          {(() => {
              const coursesLine = budgetLines.find((l) => l.key === "courses");
              const essenceLine = budgetLines.find((l) => l.key === "essence");
              const coursesBudget = 600;
              const essenceBudget = 180;
              const coursesSpent = coursesLine?.actual ?? 0;
              const essenceSpent = essenceLine?.actual ?? 0;
              const coursesPct = Math.min(100, (coursesSpent / coursesBudget) * 100);
              const essencePct = Math.min(100, (essenceSpent / essenceBudget) * 100);
              const coursesRemain = Math.max(0, coursesBudget - coursesSpent);
              const essenceRemain = Math.max(0, essenceBudget - essenceSpent);
              return (
                <div className="dashboard-v3-center">
                  <div className="dashboard-budget-gauge-card">
                    <div className="budget-gauge-item">
                      <div className="budget-gauge-header">
                        <span className="budget-gauge-label">🛒 Courses</span>
                        <span className="budget-gauge-values">{euro.format(coursesSpent)} / {euro.format(coursesBudget)}</span>
                      </div>
                      <div className="budget-gauge-track">
                        <div
                          className={`budget-gauge-fill ${coursesPct >= 90 ? "danger" : coursesPct >= 70 ? "warn" : "ok"}`}
                          style={{ width: `${coursesPct}%` }}
                        />
                      </div>
                      <span className="budget-gauge-remain">Reste {euro.format(coursesRemain)}</span>
                    </div>
                  </div>
                  <div className="dashboard-budget-gauge-card">
                    <div className="budget-gauge-item">
                      <div className="budget-gauge-header">
                        <span className="budget-gauge-label">⛽ Essence</span>
                        <span className="budget-gauge-values">{euro.format(essenceSpent)} / {euro.format(essenceBudget)}</span>
                      </div>
                      <div className="budget-gauge-track">
                        <div
                          className={`budget-gauge-fill ${essencePct >= 90 ? "danger" : essencePct >= 70 ? "warn" : "ok"}`}
                          style={{ width: `${essencePct}%` }}
                        />
                      </div>
                      <span className="budget-gauge-remain">Reste {euro.format(essenceRemain)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

          <div className="dashboard-v3-right">
            <div className="dashboard-v3-period-card">
              {renderMonthFilter(selectedMonth, onMonthChange, loading)}
            </div>
            <div className="dashboard-v3-total-card">
              <div className="dashboard-v3-total-main">
                <span className="dashboard-v3-total-label">
                  Total depenses + remboursement
                </span>
                <strong>{euro.format(totalWithReimbursements)}</strong>
              </div>
              <div className="dashboard-v3-total-meta">
                <span>{euro.format(monthlyTotal)} depenses</span>
                <span>{euro.format(reimbursementTotal)} remboursements</span>
              </div>
            </div>
            <span className="dashboard-v3-status-line">
              Etat connexion : {dashboardStatus}
            </span>
          </div>
        </div>
      </section>

      <section className={`stats-grid dashboard-v3-kpi-grid ${loading ? "section-fading" : ""}`}>
        <article className="card accent-blue dashboard-v3-kpi-card">
          <span className="card-label">Solde du compte</span>
          <strong className="card-value">
            {accountBalanceValue !== null ? euro.format(accountBalanceValue) : "--"}
          </strong>
        </article>

        <article className="card accent-mint dashboard-v3-kpi-card">
          <span className="card-label">Reste en cours</span>
          <strong className="card-value">{euro.format(currentRemainingValue)}</strong>
        </article>

        <article className="card accent-rose dashboard-v3-kpi-card">
          <span className="card-label">Reste theorique</span>
          <strong className="card-value">{euro.format(theoreticalRemainingValue)}</strong>
        </article>

        <button
          type="button"
          className="card accent-salmon dashboard-v3-kpi-card dashboard-v3-kpi-card-button"
          onClick={onOpenUnexpectedSpendModal}
        >
          <span className="card-label">Depense non prevue</span>
          <strong className={`card-value tickets-diff-text ${unexpectedSpendTone}`}>
            {unexpectedSpendTotalValue !== null
              ? formatBudgetDifference(unexpectedSpendTotalValue)
              : "--"}
          </strong>
        </button>
      </section>

      <section className={`dashboard-v3-bottom-grid ${loading ? "section-fading" : ""}`}>
        <article className="panel dashboard-v3-activity-panel">
          <div className="panel-body dashboard-v3-activity-body">
            <div className="dashboard-v3-side-head">
              <span className="panel-kicker">Activite recente</span>
              <h2>Derniers tickets</h2>
            </div>

            {loading && <div className="status info">Chargement des tickets...</div>}

            {!loading && error && renderGoogleSheetsError(error)}

            {!loading &&
              !error &&
              recentTickets.map((ticket, index) => (
                <div className="dashboard-v3-subscription-row" key={`${ticket.date}-${ticket.description}-${index}`}>
                  <div className="dashboard-v3-ticket-row-info">
                    <strong>{ticket.description || "Sans description"}</strong>
                    <span>{ticket.category || "Sans categorie"} • {ticket.date || "Sans date"}</span>
                  </div>
                  <strong>{euro.format(ticket.amount)}</strong>
                </div>
              ))}

            {!loading && !error && recentTickets.length === 0 && (
              <div className="status info">Aucun ticket trouve pour ce mois.</div>
            )}
          </div>
        </article>

        <article className="panel dashboard-v3-side-panel">
          <div className="panel-body dashboard-v3-side-panel-body">
            <div className="dashboard-v3-side-section">
              <div className="dashboard-v3-side-head">
                <span className="panel-kicker">
                  {subscriptions.length > 0
                    ? `${subscriptions.length} abonnement${subscriptions.length > 1 ? "s" : ""} actif${subscriptions.length > 1 ? "s" : ""} \u2022 ${euro.format(subTotal)}/mois`
                    : "Aucun abonnement enregistre"}
                </span>
                <div className="dashboard-v3-sub-title-row">
                  <h2>Abonnements</h2>
                  <div className="dashboard-v3-sub-btn-group">
                    <button
                      type="button"
                      className="dashboard-v3-sub-manage-btn"
                      onClick={onToggleSubPanel}
                    >
                      + Ajouter
                    </button>
                    {subscriptions.length > 0 && (
                      <button
                        type="button"
                        className="dashboard-v3-sub-manage-btn dashboard-v3-sub-manage-btn-delete"
                        onClick={onToggleSubDeletePanel}
                      >
                        − Supprimer
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {subscriptions.length > 0 && (
                <div className="dashboard-v3-subscription-list">
                  {subscriptions.map((item) => (
                    <div className="dashboard-v3-subscription-row" key={item.id}>
                      <span>{item.label}</span>
                      <strong>{euro.format(item.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {subscriptions.length === 0 && (
                <div className="dashboard-v3-sub-empty">
                  Aucun abonnement pour le moment.
                </div>
              )}
            </div>

            <div className="dashboard-v3-divider" />

            <div className="dashboard-v3-side-section">
              <div className="dashboard-v3-side-head">
                <span className="panel-kicker">{sentCount} envoyes sur {tickets.length} • {sentRatio}% traites</span>
                <h2>Tickets archives</h2>
              </div>

              <div className={`dashboard-v3-archive-card ${archiveToneClass}`}>
                <div className="dashboard-v3-archive-head">
                  <span>Progression</span>
                  <strong>{sentRatio}%</strong>
                </div>

                <div className="dashboard-v3-archive-track">
                  <div
                    className="dashboard-v3-archive-fill"
                    style={{ width: `${sentRatio}%` }}
                  />
                </div>

                <div className="dashboard-v3-archive-stats">
                  <div className="dashboard-v3-archive-stat">
                    <span>Envoyes</span>
                    <strong>{sentCount}</strong>
                  </div>
                  <div className="dashboard-v3-archive-stat">
                    <span>En attente</span>
                    <strong>{pendingCount}</strong>
                  </div>
                  <div className="dashboard-v3-archive-stat">
                    <span>Total</span>
                    <strong>{tickets.length}</strong>
                  </div>
                </div>

                {!error ? (
                  <div className="status dashboard-v3-archive-status">
                    {pendingCount === 0
                      ? "Tous les tickets sont envoyes."
                      : `${pendingCount} ticket(s) restent a envoyer.`}
                  </div>
                ) : (
                  <div className="status warn">
                    Etat connexion : Google Sheets a verifier.
                  </div>
                )}
              </div>
            </div>
          </div>
        </article>
      </section>

      {subPanelOpen && (
        <div className="modal-backdrop" onClick={onToggleSubPanel}>
          <div className="dashboard-v3-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard-v3-sub-modal-head">
              <div>
                <span className="panel-kicker">Nouvel abonnement</span>
                <h2>Ajouter un abonnement</h2>
              </div>
              <button type="button" className="modal-close" onClick={onToggleSubPanel}>
                Fermer
              </button>
            </div>

            <div className="dashboard-v3-sub-modal-body">
              <label className="field-block">
                <span>Nom de l'abonnement</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Ex: Netflix, Spotify, SFR..."
                  value={subFormLabel}
                  onChange={(e) => onSubFormLabelChange(e.target.value)}
                />
              </label>

              <label className="field-block">
                <span>Prix mensuel</span>
                <input
                  className="field-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 14,99"
                  value={subFormAmount}
                  onChange={(e) => onSubFormAmountChange(e.target.value)}
                />
              </label>

              {subFormError && (
                <p className="dashboard-v3-sub-form-error">{subFormError}</p>
              )}
            </div>

            <div className="dashboard-v3-sub-modal-actions">
              <button type="button" className="ghost-btn" onClick={onToggleSubPanel}>
                Annuler
              </button>
              <button type="button" className="primary-btn" onClick={onAddSubscription}>
                Ajouter l'abonnement
              </button>
            </div>
          </div>
        </div>
      )}

      {subDeletePanelOpen && (
        <div className="modal-backdrop" onClick={onToggleSubDeletePanel}>
          <div className="dashboard-v3-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard-v3-sub-modal-head">
              <div>
                <span className="panel-kicker">{subscriptions.length} abonnement{subscriptions.length > 1 ? "s" : ""}</span>
                <h2>Supprimer un abonnement</h2>
              </div>
              <button type="button" className="modal-close" onClick={onToggleSubDeletePanel}>
                Fermer
              </button>
            </div>

            <div className="dashboard-v3-sub-modal-body">
              {subscriptions.length > 0 ? (
                <div className="dashboard-v3-sub-delete-list">
                  {subscriptions.map((item) => (
                    <div className="dashboard-v3-sub-delete-row" key={item.id}>
                      <div className="dashboard-v3-sub-delete-row-info">
                        <strong>{item.label}</strong>
                        <span>{euro.format(item.amount)}/mois</span>
                      </div>
                      <button
                        type="button"
                        className="dashboard-v3-sub-delete-btn"
                        onClick={() => onDeleteSubscription(item.id)}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dashboard-v3-sub-empty">
                  Tous les abonnements ont ete supprimes.
                </div>
              )}
            </div>

            <div className="dashboard-v3-sub-modal-actions">
              <button type="button" className="ghost-btn" onClick={onToggleSubDeletePanel}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {unexpectedSpendModalOpen && (
        <div className="modal-backdrop" onClick={onCloseUnexpectedSpendModal}>
          <div
            className="dashboard-v3-unexpected-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dashboard-v3-unexpected-head">
              <div>
                <span className="panel-kicker">Depenses non prevues</span>
                <h2>{getSelectedMonthLabel(selectedMonth)}</h2>
                <p>
                  Basee uniquement sur les categories non prevues du sheet
                  en C25:C36 et C38, avec les tickets associes.
                </p>
              </div>

              <button type="button" className="modal-close" onClick={onCloseUnexpectedSpendModal}>
                Fermer
              </button>
            </div>

            <div className="dashboard-v3-unexpected-summary">
              <div className="dashboard-v3-unexpected-tile">
                <span>Total delta</span>
                <strong className={unexpectedSpendTone}>
                  {unexpectedSpendTotalValue !== null
                    ? formatBudgetDifference(unexpectedSpendTotalValue)
                    : "--"}
                </strong>
              </div>

              <div className="dashboard-v3-unexpected-tile">
                <span>Total categories non prevues</span>
                <strong>{euro.format(unexpectedSpendCategoryTotalValue)}</strong>
              </div>

              <div className="dashboard-v3-unexpected-tile">
                <span>Tickets reperes</span>
                <strong>{unexpectedSpendTickets.length}</strong>
              </div>
            </div>

            <div className="dashboard-v3-unexpected-body">
              {unexpectedSpendCategoryTotals.length > 0 ? (
                <div className="dashboard-v3-unexpected-category-list">
                  {unexpectedSpendCategoryTotals.map((item) => (
                    <div
                      className="dashboard-v3-unexpected-category-chip"
                      key={`unexpected-category-${item.category}`}
                    >
                      <span>{item.category}</span>
                      <strong>{euro.format(item.total)}</strong>
                      <small>{item.count} ticket(s)</small>
                    </div>
                  ))}
                </div>
              ) : null}

              {unexpectedSpendTickets.length > 0 ? (
                <div className="dashboard-v3-unexpected-list">
                  {unexpectedSpendTickets.map(({ ticket, reason }, index) => (
                    <div
                      className="dashboard-v3-unexpected-row"
                      key={`unexpected-${getTicketKey(ticket)}-${index}`}
                    >
                      <div className="dashboard-v3-unexpected-row-main">
                        <strong>{ticket.description || "Sans description"}</strong>
                        <span>{ticket.category || "Sans categorie"} • {ticket.date || "Sans date"}</span>
                        <p>{reason}</p>
                      </div>

                      <div className="dashboard-v3-unexpected-row-side">
                        <span className={`ticket-badge ${ticket.sent ? "sent" : "pending"}`}>
                          {ticket.sent ? "Envoye" : "En attente"}
                        </span>
                        <strong>{euro.format(ticket.amount)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dashboard-v3-unexpected-empty">
                  <strong>Aucune depense non prevue dans ces categories.</strong>
                  <p>
                    Aucune ligne ticket ne remonte actuellement sur les categories
                    non prevues du sheet.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function renderTickets(
  visibleTickets: Ticket[],
  allTickets: Ticket[],
  monthSummary: TicketMonthSummary | null,
  totalTicketsCount: number,
  loading: boolean,
  refreshing: boolean,
  error: string,
  collaborators: Collaborator[],
  budgetPreviewTicket: Ticket | null,
  budgetDetailsOpen: boolean,
  reimbursementForm: ReimbursementFormLine,
  reimbursementDetails: ReimbursementDetails,
  reimbursementSubmitting: boolean,
  deletingReimbursementRow: number | null,
  undoingReimbursement: boolean,
  reimbursementStatus: string,
  reimbursementError: string,
  selectedMonth: string,
  lastSyncAt: number | null,
  ticketsSheetModalOpen: boolean,
  searchQuery: string,
  categoryFilter: string,
  statusFilter: TicketStatusFilter,
  sortMode: TicketSortMode,
  onMonthChange: (month: string) => void,
  onRefreshTickets: () => void,
  csvImportBusy: boolean,
  onSearchChange: (value: string) => void,
  onCategoryFilterChange: (value: string) => void,
  onStatusFilterChange: (value: TicketStatusFilter) => void,
  onSortModeChange: (value: TicketSortMode) => void,
  onOpenTicketModal: () => void,
  onOpenCsvImportModal: () => void,
  onOpenTicketsSheetModal: () => void,
  onCloseTicketsSheetModal: () => void,
  onCloseBudgetDetails: () => void,
  onReimbursementFormChange: (patch: Partial<ReimbursementFormLine>) => void,
  onSubmitReimbursements: () => void,
  onDeleteReimbursement: (row: number) => void,
  onTicketHover: (ticket: Ticket) => void,
  onTicketLeave: () => void,
  editingTicket: Ticket | null,
  editTicketForm: { date: string; description: string; category: string; amount: string },
  editTicketSaving: boolean,
  editTicketError: string,
  onStartEditTicket: (ticket: Ticket) => void,
  onCancelEditTicket: () => void,
  onEditTicketFormChange: (patch: Partial<{ date: string; description: string; category: string; amount: string }>) => void,
  onSaveEditTicket: () => void
) {
  const monthlyTotal = allTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const isBusy = loading || refreshing;
  const selectedMonthLabel = getSelectedMonthLabel(selectedMonth);
  const sheetTickets = filterAndSortTickets(allTickets, "", "all", "all", sortMode);
  const sheetSentCount = sheetTickets.filter((ticket) => ticket.sent).length;
  const sheetPendingCount = sheetTickets.length - sheetSentCount;
  const sheetTotal = sheetTickets.reduce((sum, ticket) => sum + ticket.amount, 0);

  const budgetLines = computeTicketBudgetLines(allTickets);
  const budgetPlannedTotal = budgetLines.reduce((sum, line) => sum + line.planned, 0);
  const budgetActualTotal = budgetLines.reduce((sum, line) => sum + line.actual, 0);
  const budgetDifferenceTotal = budgetActualTotal - budgetPlannedTotal;

  const monthlyIncome = ticketsFinancePreset.monthlyIncome;
  const currentBalance = monthlyIncome - monthlyTotal;
  const theoreticalRemaining = monthlyIncome - budgetPlannedTotal;
  const accountBalanceValue = monthSummary?.accountBalance ?? null;
  const currentRemainingValue = monthSummary?.currentRemaining ?? currentBalance;
  const theoreticalRemainingValue =
    monthSummary?.theoreticalRemaining ?? theoreticalRemaining;
  const unexpectedSpendTotalValue =
    monthSummary?.unexpectedSpendTotal ??
    (currentRemainingValue !== null && theoreticalRemainingValue !== null
      ? currentRemainingValue - theoreticalRemainingValue
      : null);
  const unexpectedSpendTone =
    unexpectedSpendTotalValue !== null
      ? getBudgetDifferenceTone(unexpectedSpendTotalValue)
      : "neutral";
  const showMonthLoading = loading;

  const renderStatsCardLoader = () => (
    <div className="card-loading-content" aria-hidden="true">
      <div className="card-loader-shell">
        <div className="card-loader">
          <span className="card-loader-ring" />
          <span className="card-loader-orbit" />
          <span className="card-loader-core" />
        </div>
      </div>

      <div className="card-loading-skeletons">
        <span className="card-skeleton card-skeleton-value" />
        <span className="card-skeleton card-skeleton-sub" />
      </div>
    </div>
  );

  return (
    <>
      <section className="topbar tickets-topbar">
        <div>
          <span className="eyebrow">Tickets</span>
          <h1>Vue mensuelle des depenses capturees</h1>
          <p>
            Un espace compact pour verifier le flux, les montants et l etat d envoi
            sur {selectedMonthLabel.toLowerCase()}.
          </p>
        </div>
        <div className="topbar-actions">
          {renderMonthFilter(selectedMonth, onMonthChange, loading)}
          <button
            className="ghost-btn"
            onClick={onOpenCsvImportModal}
            disabled={csvImportBusy}
          >
            {csvImportBusy ? "Analyse CSV..." : "Importer CSV"}
          </button>
          <button className="ghost-btn refresh-btn" onClick={onRefreshTickets}>
            {isBusy ? "Actualisation..." : "Actualiser"}
          </button>
          <button className="primary-btn" onClick={onOpenTicketModal}>
            Ajouter un ticket
          </button>
        </div>
      </section>

      <section className={`stats-grid tickets-stats-grid ${loading ? "section-fading" : ""}`}>
        <article className={`card accent-blue ${showMonthLoading ? "card-loading" : ""}`}>
          <span className="card-label">Solde du compte</span>
          {showMonthLoading ? (
            renderStatsCardLoader()
          ) : (
            <>
              <strong className="card-value">
                {accountBalanceValue !== null ? euro.format(accountBalanceValue) : "--"}
              </strong>
            </>
          )}
        </article>

        <article className={`card accent-mint ${showMonthLoading ? "card-loading" : ""}`}>
          <span className="card-label">Reste en cours</span>
          {showMonthLoading ? (
            renderStatsCardLoader()
          ) : (
            <>
              <strong className="card-value">{euro.format(currentRemainingValue)}</strong>
            </>
          )}
        </article>

        <article className={`card accent-rose ${showMonthLoading ? "card-loading" : ""}`}>
          <span className="card-label">Reste theorique</span>
          {showMonthLoading ? (
            renderStatsCardLoader()
          ) : (
            <>
              <strong className="card-value">{euro.format(theoreticalRemainingValue)}</strong>
            </>
          )}
        </article>

        <article className={`card accent-salmon ${showMonthLoading ? "card-loading" : ""}`}>
          <span className="card-label">Depense non prevue total</span>
          {showMonthLoading ? (
            renderStatsCardLoader()
          ) : (
            <>
              <strong className={`card-value tickets-diff-text ${unexpectedSpendTone}`}>
                {unexpectedSpendTotalValue !== null
                  ? formatBudgetDifference(unexpectedSpendTotalValue)
                  : "--"}
              </strong>
            </>
          )}
        </article>
      </section>

      <section className={`content-grid ${loading ? "section-fading" : ""}`}>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Registre</span>
              <div className="panel-title-row">
                <h2>Liste des tickets</h2>
              </div>
            </div>
            <div className="panel-head-actions">
              <button
                type="button"
                className="panel-link"
                onClick={onOpenTicketsSheetModal}
              >
                Vue feuille
              </button>
              <button type="button" className="panel-link">
                Exporter
              </button>
            </div>
          </div>

          <div className="panel-body table-body">
            <div className="ticket-toolbar">
              <div className="ticket-toolbar-head">
                <div className="ticket-toolbar-title">
                  <span className="ticket-toolbar-kicker">Recherche et filtres</span>
                  <strong>Affinage instantane des tickets</strong>
                </div>

                <div className="ticket-toolbar-meta">
                  <span>{visibleTickets.length} ticket(s) affiches sur {totalTicketsCount}</span>
                  <span>
                    {searchQuery.trim() || categoryFilter !== "all" || statusFilter !== "all"
                      ? "Filtres actifs"
                      : isBusy
                        ? "Synchro en cours..."
                        : lastSyncAt
                          ? <LiveRelativeSyncLabel syncedAt={lastSyncAt} />
                          : "Vue complete"}
                  </span>
                </div>
              </div>

              <div className="ticket-toolbar-grid">
                <label className="ticket-filter-group ticket-filter-group-search">
                  <span>Recherche</span>
                  <input
                    data-history-global="true"
                    className="field-input"
                    type="search"
                    value={searchQuery}
                    placeholder="Rechercher un ticket, une date ou une categorie"
                    onChange={(event) => onSearchChange(event.target.value)}
                  />
                </label>

                <label className="ticket-filter-group">
                  <span>Categorie</span>
                  <select
                    data-history-global="true"
                    className="field-input"
                    value={categoryFilter}
                    onChange={(event) => onCategoryFilterChange(event.target.value)}
                  >
                    <option value="all">Toutes les categories</option>
                    {SHEET_ALL_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="ticket-filter-group">
                  <span>Statut</span>
                  <select
                    data-history-global="true"
                    className="field-input"
                    value={statusFilter}
                    onChange={(event) =>
                      onStatusFilterChange(event.target.value as TicketStatusFilter)
                    }
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="sent">Deja envoyes</option>
                    <option value="pending">A envoyer</option>
                  </select>
                </label>

                <label className="ticket-filter-group">
                  <span>Tri</span>
                  <select
                    data-history-global="true"
                    className="field-input"
                    value={sortMode}
                    onChange={(event) => onSortModeChange(event.target.value as TicketSortMode)}
                  >
                    <option value="date_desc">Plus recents</option>
                    <option value="date_asc">Plus anciens</option>
                    <option value="amount_desc">Montant decroissant</option>
                    <option value="amount_asc">Montant croissant</option>
                    <option value="description_asc">Description A-Z</option>
                  </select>
                </label>
              </div>
            </div>

            {loading && <div className="status info">Chargement des tickets...</div>}

            {!loading && error && renderGoogleSheetsError(error)}

            {!loading &&
              !error &&
              visibleTickets.map((ticket, index) => {
                const ticketKey = getTicketKey(ticket);
                const watchingPeers = collaborators.filter((peer) => peer.focusTicketKey === ticketKey);
                const isEditing = editingTicket !== null && getTicketKey(editingTicket) === ticketKey;

                if (isEditing) {
                  return (
                    <div
                      className={`ticket-row ticket-row-editing${editTicketSaving ? " ticket-row-saving" : ""}`}
                      key={`${ticket.date}-${ticket.description}-${index}`}
                    >
                      {editTicketSaving ? (
                        <div className="ticket-saving-overlay">
                          <div className="card-loader">
                            <span className="card-loader-ring" />
                            <span className="card-loader-orbit" />
                            <span className="card-loader-core" />
                          </div>
                          <span className="ticket-saving-label">Modification en cours...</span>
                        </div>
                      ) : null}

                      <div className={`ticket-edit-form${editTicketSaving ? " ticket-edit-form-blurred" : ""}`}>
                        <div className="ticket-edit-header">
                          <span className="ticket-edit-kicker">Modification du ticket</span>
                          <span className="ticket-edit-origin">
                            <span className="ticket-edit-origin-desc">{ticket.description || "Sans description"}</span>
                            <span className="ticket-edit-origin-sep">·</span>
                            <span className="ticket-edit-origin-amount">{euro.format(ticket.amount)}</span>
                            <span className="ticket-edit-origin-sep">·</span>
                            <span className="ticket-edit-origin-date">{ticket.date}</span>
                          </span>
                        </div>

                        <div className="ticket-edit-fields">
                          <label className="ticket-edit-field">
                            <span>Description</span>
                            <input
                              className="field-input"
                              type="text"
                              value={editTicketForm.description}
                              onChange={(e) => onEditTicketFormChange({ description: e.target.value })}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Escape") onCancelEditTicket(); }}
                            />
                          </label>
                          <label className="ticket-edit-field">
                            <span>Montant (€)</span>
                            <input
                              className="field-input"
                              type="text"
                              inputMode="decimal"
                              value={editTicketForm.amount}
                              onChange={(e) => onEditTicketFormChange({ amount: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") onCancelEditTicket();
                                if (e.key === "Enter") onSaveEditTicket();
                              }}
                            />
                          </label>
                          <label className="ticket-edit-field">
                            <span>Date</span>
                            <input
                              className="field-input"
                              type="date"
                              value={editTicketForm.date}
                              onChange={(e) => onEditTicketFormChange({ date: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Escape") onCancelEditTicket(); }}
                            />
                          </label>
                          <label className="ticket-edit-field ticket-edit-field-category">
                            <span>Categorie</span>
                            <select
                              className="field-input"
                              value={editTicketForm.category}
                              onChange={(e) => onEditTicketFormChange({ category: e.target.value })}
                            >
                              <option value="">Sans categorie</option>
                              {SHEET_ALL_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        {editTicketError && <div className="ticket-edit-error">{editTicketError}</div>}

                        <div className="ticket-edit-actions">
                          <button className="ghost-btn" onClick={onCancelEditTicket} disabled={editTicketSaving}>
                            Annuler
                          </button>
                          <button className="primary-btn" onClick={onSaveEditTicket} disabled={editTicketSaving}>
                            Sauvegarder
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    className={`ticket-row ${watchingPeers.length ? "ticket-row-active" : ""}`}
                    key={`${ticket.date}-${ticket.description}-${index}`}
                    onMouseEnter={() => onTicketHover(ticket)}
                    onMouseLeave={onTicketLeave}
                    onDoubleClick={() => {
                      if (Number.isFinite(ticket.sheetRow) && Number.isFinite(ticket.blockIndex)) {
                        onStartEditTicket(ticket);
                      }
                    }}
                  >
                    <div className="ticket-main">
                      <div className="ticket-title-row">
                        <strong>{ticket.description || "Sans description"}</strong>
                        {Number.isFinite(ticket.sheetRow) && (
                          <button
                            className="ticket-edit-btn"
                            title="Modifier ce ticket"
                            onClick={(e) => { e.stopPropagation(); onStartEditTicket(ticket); }}
                          >
                            ✏️
                          </button>
                        )}
                      </div>

                      <div className="ticket-meta-row">
                        <span className="ticket-meta-chip">{ticket.date || "Sans date"}</span>
                        <span className="ticket-meta-chip">{ticket.category || "Sans categorie"}</span>
                      </div>

                      {watchingPeers.length ? (
                        <div className="ticket-peer-list">
                          {watchingPeers.map((peer) => (
                            <span className="ticket-peer-chip" key={`${peer.id}-${ticketKey}`}>
                              <span
                                className="collab-dot"
                                style={{ backgroundColor: peer.color }}
                              />
                              {peer.name} regarde ce ticket
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="ticket-side">
                      <span className={`ticket-badge ${ticket.sent ? "sent" : "pending"}`}>
                        {ticket.sent ? "Envoye" : "En attente"}
                      </span>
                      <strong className="ticket-amount">{euro.format(ticket.amount)}</strong>
                    </div>
                  </div>
                );
              })}

            {!loading && !error && visibleTickets.length === 0 && (
              <div className="status info">Aucun ticket trouve.</div>
            )}
          </div>
        </article>

        <article className="panel tickets-budget-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Remboursements</span>
              <h2>Saisie rapide</h2>
            </div>
          </div>

          <div className="panel-body tickets-budget-body">
            <div className="tickets-reimburse-card">
              <div className="tickets-special-head">
                <span className="tickets-impact-kicker">Section remboursements du sheet</span>
                <strong>Ajoute un remboursement en une fois</strong>
              </div>

              <div className="tickets-reimburse-row">
                <select
                  data-history-global="true"
                  className="field-input"
                  value={reimbursementForm.category}
                  onChange={(event) => onReimbursementFormChange({ category: event.target.value })}
                >
                  <option value="">Selectionner</option>
                  {reimbursementCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                <input
                  data-history-global="true"
                  className="field-input"
                  type="text"
                  inputMode="decimal"
                  value={reimbursementForm.amount}
                  placeholder="Montant"
                  onChange={(event) => onReimbursementFormChange({ amount: event.target.value })}
                />
              </div>

              {reimbursementStatus ? <div className="status ok">{reimbursementStatus}</div> : null}
              {reimbursementError ? <div className="status warn">{reimbursementError}</div> : null}

              <div className="reimbursement-active-card">
                <div className="reimbursement-active-head">
                  <div>
                    <span className="tickets-impact-kicker">Actifs sur {selectedMonthLabel}</span>
                    <strong>Remboursements en cours</strong>
                  </div>
                  <div className="reimbursement-active-summary">
                    <span>{reimbursementDetails.entries.length} ligne(s)</span>
                    <strong>{euro.format(reimbursementDetails.total)}</strong>
                  </div>
                </div>

                {reimbursementDetails.entries.length ? (
                  <div className="reimbursement-active-list">
                    {reimbursementDetails.entries.map((entry) => {
                      const isDeleting = deletingReimbursementRow === entry.row;

                      return (
                        <div
                          className={`reimbursement-active-item ${isDeleting ? "reimbursement-deleting" : ""} ${undoingReimbursement ? "reimbursement-deleting" : ""}`}
                          key={`reimbursement-inline-row-${entry.row}`}
                        >
                          {isDeleting ? (
                            <div className="reimbursement-deleting-overlay">
                              <div className="card-loader">
                                <span className="card-loader-ring" />
                                <span className="card-loader-orbit" />
                                <span className="card-loader-core" />
                              </div>
                              <span className="reimbursement-deleting-label">Suppression...</span>
                            </div>
                          ) : undoingReimbursement ? (
                            <div className="reimbursement-deleting-overlay reimbursement-undoing-overlay">
                              <div className="card-loader">
                                <span className="card-loader-ring" />
                                <span className="card-loader-orbit" />
                                <span className="card-loader-core" />
                              </div>
                              <span className="reimbursement-undoing-label">Restauration...</span>
                            </div>
                          ) : null}

                          <div className="reimbursement-active-main">
                            <span className="reimbursement-active-type">{entry.category}</span>
                            <strong>{euro.format(entry.amount)}</strong>
                          </div>

                          <span className="reimbursement-active-cell">{`H${entry.row} / I${entry.row}`}</span>

                          <button
                            type="button"
                            className="ghost-btn reimbursement-inline-delete"
                            onClick={() => onDeleteReimbursement(entry.row)}
                            disabled={isDeleting}
                            title={`Supprimer ${entry.category} en H${entry.row}`}
                          >
                            {isDeleting ? "..." : "✕"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="reimbursement-empty-state">
                    Aucun remboursement actif pour le moment sur ce mois.
                  </div>
                )}
              </div>

              <div className="tickets-special-note">
                {budgetPreviewTicket
                  ? `Ticket survole: ${budgetPreviewTicket.description || "Sans description"} • ${budgetPreviewTicket.category || "Sans categorie"}`
                  : "Le nouveau remboursement sera ajoute dans le premier emplacement libre du mois."}
              </div>

              <div className="ticket-modal-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={onSubmitReimbursements}
                  disabled={reimbursementSubmitting}
                >
                  {reimbursementSubmitting ? "Enregistrement..." : "Ajouter les remboursements"}
                </button>
              </div>
            </div>

            {collaborators.some((peer) => peer.page === "tickets") ? (
              <div className="tickets-special-note">
                {collaborators
                  .filter((peer) => peer.page === "tickets")
                  .map((peer) => `${peer.name} sur ${peer.context || selectedMonthLabel}`)
                  .join(" • ")}
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {budgetDetailsOpen ? (
        <div className="budget-overlay" onClick={onCloseBudgetDetails}>
          <div className="budget-modal" onClick={(event) => event.stopPropagation()}>
            <div className="budget-modal-head">
              <div>
                <span className="eyebrow">Budget du mois</span>
                <h2>Prevu / Reel / Difference</h2>
                <p>Vue complete des lignes budget pour {selectedMonthLabel.toLowerCase()}.</p>
              </div>

              <button type="button" className="modal-close" onClick={onCloseBudgetDetails}>
                Fermer
              </button>
            </div>

            <div className="budget-modal-summary">
              <div className="budget-modal-tile">
                <span>Revenus</span>
                <strong>{euro.format(monthlyIncome)}</strong>
              </div>

              <div className="budget-modal-tile">
                <span>Total prevu</span>
                <strong>{euro.format(budgetPlannedTotal)}</strong>
              </div>

              <div className="budget-modal-tile">
                <span>Total reel</span>
                <strong>{euro.format(budgetActualTotal)}</strong>
              </div>

              <div className="budget-modal-tile">
                <span>Difference globale</span>
                <strong className={getBudgetDifferenceTone(budgetDifferenceTotal)}>
                  {formatBudgetDifference(budgetDifferenceTotal)}
                </strong>
              </div>
            </div>

            <div className="budget-table">
              <div className="budget-table-head">
                <span>Categorie</span>
                <span>Prevu</span>
                <span>Reel</span>
                <span>Difference</span>
              </div>

              {budgetLines.map((line) => {
                const tone = getBudgetDifferenceTone(line.difference);

                return (
                  <div className="budget-table-row" key={line.key}>
                    <span className="budget-table-cell budget-table-label">{line.label}</span>
                    <span className="budget-table-cell">{euro.format(line.planned)}</span>
                    <span className="budget-table-cell">{euro.format(line.actual)}</span>
                    <span className={`budget-table-cell budget-table-diff ${tone}`}>
                      {formatBudgetDifference(line.difference)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="budget-modal-foot">
              Revenu de reference actuel: {euro.format(monthlyIncome)}. Tu peux l ajuster dans
              <code> ticketsFinancePreset </code>.
            </div>
          </div>
        </div>
      ) : null}

      {ticketsSheetModalOpen ? (
        <div className="modal-backdrop" onClick={onCloseTicketsSheetModal}>
          <div
            className="tickets-sheet-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="tickets-sheet-modal-head">
              <div>
                <span className="panel-kicker">Vue feuille integrale</span>
                <h2>Tous les tickets de {selectedMonthLabel.toLowerCase()}</h2>
                <p>
                  Une grande lecture type Google Sheets pour balayer toutes les
                  lignes du mois sans ouvrir chaque ticket.
                </p>
              </div>

              <div className="tickets-sheet-modal-head-actions">
                <span className="tickets-sheet-sync-chip">
                  <LiveRelativeSyncLabel
                    syncedAt={lastSyncAt}
                    loading={isBusy}
                    waitingLabel="Donnees en attente"
                  />
                </span>
                <button
                  type="button"
                  className="modal-close"
                  onClick={onCloseTicketsSheetModal}
                >
                  Fermer
                </button>
              </div>
            </div>

            <div className="tickets-sheet-modal-summary">
              <div className="tickets-sheet-modal-tile">
                <span>Lignes</span>
                <strong>{sheetTickets.length}</strong>
              </div>
              <div className="tickets-sheet-modal-tile">
                <span>Total du mois</span>
                <strong>{euro.format(sheetTotal)}</strong>
              </div>
              <div className="tickets-sheet-modal-tile">
                <span>Envoyes</span>
                <strong>{sheetSentCount}</strong>
              </div>
              <div className="tickets-sheet-modal-tile">
                <span>En attente</span>
                <strong>{sheetPendingCount}</strong>
              </div>
            </div>

            <div className="tickets-sheet-table-shell">
              {!loading && error ? renderGoogleSheetsError(error) : null}

              {!loading && !error && sheetTickets.length > 0 ? (
                <div className="tickets-sheet-table-wrap">
                  <table className="tickets-sheet-table">
                    <thead>
                      <tr>
                        <th>Ligne</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Categorie</th>
                        <th>Statut</th>
                        <th>Montant</th>
                      </tr>
                    </thead>

                    <tbody>
                      {sheetTickets.map((ticket, index) => (
                        <tr key={`sheet-ticket-${getTicketKey(ticket)}-${index}`}>
                          <td className="tickets-sheet-row-number">
                            {Number.isFinite(ticket.sheetRow) ? ticket.sheetRow : index + 1}
                          </td>
                          <td>{ticket.date || "--"}</td>
                          <td className="tickets-sheet-description-cell">
                            <strong>{ticket.description || "Sans description"}</strong>
                          </td>
                          <td>{ticket.category || "Sans categorie"}</td>
                          <td>
                            <span className={`ticket-badge ${ticket.sent ? "sent" : "pending"}`}>
                              {ticket.sent ? "Envoye" : "En attente"}
                            </span>
                          </td>
                          <td className="tickets-sheet-amount-cell">
                            {euro.format(ticket.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {!loading && !error && sheetTickets.length === 0 ? (
                <div className="tickets-sheet-empty">
                  Aucun ticket disponible pour ce mois.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}

function renderAudits(
  tickets: Ticket[],
  monthSummary: TicketMonthSummary | null,
  selectedMonth: string,
  referenceMonth: string,
  referenceState: CompareMonthState,
  loading: boolean,
  refreshing: boolean,
  error: string,
  lastSyncAt: number | null,
  subscriptions: DashboardSubscription[],
  onMonthChange: (month: string) => void,
  onReferenceMonthChange: (month: string) => void,
  onRefresh: () => void
) {
  const selectedMonthLabel = getSelectedMonthLabel(selectedMonth);
  const referenceMonthLabel = getSelectedMonthLabel(referenceMonth);
  const sameReference = referenceMonth === selectedMonth;
  const effectiveReferenceTickets = sameReference ? tickets : referenceState.tickets;
  const effectiveReferenceSummary = sameReference ? monthSummary : referenceState.summary;
  const referenceLoading = sameReference ? loading || refreshing : referenceState.loading;
  const referenceError = sameReference ? error : referenceState.error;
  const auditLoading = loading || refreshing || referenceLoading;
  const report = buildAuditReport(
    tickets,
    monthSummary,
    effectiveReferenceTickets,
    subscriptions
  );
  const currentMetrics = buildCompareMonthMetrics(tickets, monthSummary);
  const referenceMetrics = buildCompareMonthMetrics(
    effectiveReferenceTickets,
    effectiveReferenceSummary
  );
  const totalDelta = currentMetrics.total - referenceMetrics.total;
  const totalDeltaTone = getBudgetDifferenceTone(totalDelta);
  const referenceSyncLabel = sameReference
    ? `Base identique a ${selectedMonthLabel}`
    : referenceLoading
        ? "Chargement..."
        : referenceState.syncedAt
          ? <LiveRelativeSyncLabel syncedAt={referenceState.syncedAt} />
          : "En attente";

  return (
    <>
      <section className="topbar audit-topbar">
        <div>
          <span className="eyebrow">Lecture intelligente</span>
          <h1>Audits budget</h1>
          <p>
            Cette page cherche les signaux faibles et les points chauds du mois:
            montants inhabituels, doublons probables, categories qui accelerent
            et charges recurrentes a cadrer.
          </p>
        </div>

        <div className="topbar-actions audit-topbar-actions">
          <label className="audit-select-card">
            <span>Base de comparaison</span>
            <select
              className="field-input"
              value={referenceMonth}
              onChange={(event) => onReferenceMonthChange(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={`audit-reference-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="outline-btn" onClick={onRefresh}>
            {auditLoading ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </section>

      <section className="content-grid audit-control-grid">
        <article className="panel audit-period-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Periode analysee</span>
              <h2>Choix du mois</h2>
            </div>
          </div>

          <div className="panel-body">
            {renderMonthFilter(selectedMonth, onMonthChange, loading)}
          </div>
        </article>

        <article className="panel audit-reference-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Contexte</span>
              <h2>Base de lecture</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="audit-reference-grid">
              <div className="audit-reference-card current">
                <span>Mois audit</span>
                <strong>{selectedMonthLabel}</strong>
                <p>
                  {loading || refreshing
                    ? "Actualisation..."
                    : lastSyncAt
                      ? <LiveRelativeSyncLabel syncedAt={lastSyncAt} />
                      : "Donnees en cours de lecture"}
                </p>
              </div>

              <div className="audit-reference-card">
                <span>Reference</span>
                <strong>{referenceMonthLabel}</strong>
                <p>{referenceSyncLabel}</p>
              </div>
            </div>

            {sameReference ? (
              <div className="status info">
                Choisis un autre mois de reference pour faire ressortir les ecarts.
              </div>
            ) : null}

            {referenceError ? (
              <div className="status warn">
                {referenceMonthLabel}: {referenceError}
              </div>
            ) : (
              <div className="audit-reference-strip">
                <span>{selectedMonthLabel} {euro.format(currentMetrics.total)}</span>
                <strong className={totalDeltaTone}>
                  {formatBudgetDifference(totalDelta)}
                </strong>
                <span>{referenceMonthLabel} {euro.format(referenceMetrics.total)}</span>
              </div>
            )}
          </div>
        </article>
      </section>

      {loading ? (
        <div className="status info audit-inline-banner">
          Lecture du mois en cours...
        </div>
      ) : null}

      {!loading && error ? renderGoogleSheetsError(error) : null}

      {!loading && !error && tickets.length === 0 ? (
        <div className="status info audit-inline-banner">
          Aucun ticket disponible pour {selectedMonthLabel.toLowerCase()}.
        </div>
      ) : null}

      <section className="stats-grid audit-stats-grid">
        <article className={`card ${report.statusTone === "ok" ? "accent-mint" : report.statusTone === "warning" ? "accent-gold" : "accent-salmon"}`}>
          <span className="card-label">Score sante</span>
          <strong className="card-value">{report.score}/100</strong>
          <span className="card-sub">{report.statusLabel}</span>
        </article>

        <article className={`card ${totalDeltaTone === "warn" ? "accent-salmon" : totalDeltaTone === "ok" ? "accent-mint" : "accent-blue"}`}>
          <span className="card-label">Ecart vs reference</span>
          <strong className={`card-value audit-card-delta ${totalDeltaTone}`}>
            {formatBudgetDifference(totalDelta)}
          </strong>
          <span className="card-sub">
            {selectedMonthLabel} contre {referenceMonthLabel}
          </span>
        </article>

        <article className="card accent-blue">
          <span className="card-label">Montant sous loupe</span>
          <strong className="card-value">{euro.format(report.underWatchTotal)}</strong>
          <span className="card-sub">
            {report.flaggedTickets.length} ticket(s) a relire
          </span>
        </article>

        <article className="card accent-rose">
          <span className="card-label">Charges recurrentes</span>
          <strong className="card-value">{report.recurringCandidates.length}</strong>
          <span className="card-sub">
            {report.untrackedRecurringCount} non suivie(s) comme abonnement
          </span>
        </article>
      </section>

      <section className="content-grid audit-main-grid">
        <article className="panel audit-alerts-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Priorite du mois</span>
              <h2>Alertes et signaux</h2>
            </div>
          </div>

          <div className="panel-body stack audit-alerts-list">
            {report.alerts.slice(0, 6).map((alert) => (
              <div
                className={`audit-alert-item audit-alert-${alert.severity}`}
                key={alert.id}
              >
                <div className="audit-alert-icon">{alert.icon}</div>
                <div className="audit-alert-main">
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
                {typeof alert.amount === "number" ? (
                  <strong className="audit-alert-amount">{euro.format(alert.amount)}</strong>
                ) : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel audit-score-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Lecture manager</span>
              <h2>Synthese du mois</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className={`audit-score-card ${report.statusTone}`}>
              <span>Etat global</span>
              <strong>{report.statusLabel}</strong>
              <p>
                {report.statusTone === "ok"
                  ? "Le mois reste assez stable avec peu de signaux chauds."
                  : report.statusTone === "warning"
                    ? "Quelques points demandent une relecture avant qu ils ne deviennent structurels."
                    : "Plusieurs signaux se cumulent. Il vaut mieux regarder le detail maintenant."}
              </p>
            </div>

            <div className="audit-breakdown-grid">
              <div className="audit-breakdown-tile critical">
                <span>Critiques</span>
                <strong>{report.criticalCount}</strong>
              </div>
              <div className="audit-breakdown-tile warning">
                <span>Warnings</span>
                <strong>{report.warningCount}</strong>
              </div>
              <div className="audit-breakdown-tile ok">
                <span>Points verts</span>
                <strong>{report.okCount}</strong>
              </div>
              <div className="audit-breakdown-tile neutral">
                <span>Doublons</span>
                <strong>{report.duplicateGroupCount}</strong>
              </div>
            </div>

            <div className="audit-summary-list">
              <div className="audit-summary-row">
                <span>Reste en cours</span>
                <strong>{euro.format(currentMetrics.currentRemaining)}</strong>
              </div>
              <div className="audit-summary-row">
                <span>Depense non prevue</span>
                <strong className={getBudgetDifferenceTone(currentMetrics.unexpectedSpend)}>
                  {formatBudgetDifference(currentMetrics.unexpectedSpend)}
                </strong>
              </div>
              <div className="audit-summary-row">
                <span>Tickets inhabituels</span>
                <strong>{report.outlierCount}</strong>
              </div>
              <div className="audit-summary-row">
                <span>Tickets en attente</span>
                <strong>{currentMetrics.pendingCount}</strong>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="content-grid audit-detail-grid">
        <article className="panel audit-category-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Categories qui bougent</span>
              <h2>Radar categories</h2>
            </div>
          </div>

          <div className="panel-body audit-category-list">
            {report.categoryDeltas.slice(0, 7).map((row) => {
              const tone = getBudgetDifferenceTone(row.delta);

              return (
                <div className="audit-category-row" key={`audit-category-${row.category}`}>
                  <div className="audit-category-main">
                    <strong>{row.category}</strong>
                    <span>
                      {selectedMonthLabel} {euro.format(row.currentAmount)} vs {referenceMonthLabel} {euro.format(row.referenceAmount)}
                    </span>
                  </div>
                  <strong className={`audit-category-delta ${tone}`}>
                    {formatBudgetDifference(row.delta)}
                  </strong>
                </div>
              );
            })}

            {report.categoryDeltas.length === 0 ? (
              <div className="status info">
                Les deltas de categories apparaitront ici des que les deux mois auront des donnees.
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel audit-recurring-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Repetition</span>
              <h2>Charges recurrentes</h2>
            </div>
          </div>

          <div className="panel-body audit-recurring-list">
            {report.recurringCandidates.slice(0, 6).map((item) => (
              <div className="audit-recurring-row" key={`audit-recurring-${item.key}`}>
                <div className="audit-recurring-main">
                  <strong>{item.label}</strong>
                  <span>
                    {item.category} • {selectedMonthLabel} {euro.format(item.currentAmount)} • {referenceMonthLabel} {euro.format(item.referenceAmount)}
                  </span>
                </div>

                <div className="audit-recurring-side">
                  <span className={`audit-recurring-tag ${item.tracked ? "tracked" : "untracked"}`}>
                    {item.tracked ? `Suivi: ${item.trackedLabel}` : "A cadrer"}
                  </span>
                  <strong className={getBudgetDifferenceTone(item.delta)}>
                    {formatBudgetDifference(item.delta)}
                  </strong>
                </div>
              </div>
            ))}

            {report.recurringCandidates.length === 0 ? (
              <div className="status info">
                Aucune charge recurrente claire n a ete detectee entre ces deux mois.
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="panel audit-flagged-panel">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">Tickets a relire</span>
            <h2>Montants et mouvements sous surveillance</h2>
          </div>
        </div>

        <div className="panel-body audit-flagged-list">
          {report.flaggedTickets.slice(0, 8).map((item) => (
            <div
              className={`audit-flagged-row audit-flagged-${item.severity}`}
              key={`audit-flagged-${item.key}`}
            >
              <div className="audit-flagged-main">
                <strong>{item.ticket.description || "Sans description"}</strong>
                <span>
                  {item.ticket.date || "Sans date"} • {item.ticket.category || "Sans categorie"}
                </span>
                <p>{item.reason}</p>
              </div>

              <div className="audit-flagged-side">
                <span className={`ticket-badge ${item.ticket.sent ? "sent" : "pending"}`}>
                  {item.ticket.sent ? "Envoye" : "En attente"}
                </span>
                <strong>{euro.format(item.ticket.amount)}</strong>
              </div>
            </div>
          ))}

          {report.flaggedTickets.length === 0 ? (
            <div className="status ok">
              Aucun ticket ne ressort comme inhabituel ou duplique pour le moment.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function renderCompare(
  primaryMonth: string,
  secondaryMonth: string,
  primaryState: CompareMonthState,
  secondaryState: CompareMonthState,
  compareSortMode: CompareSortMode,
  selectedMonth: string,
  subscriptions: DashboardSubscription[],
  onPrimaryMonthChange: (month: string) => void,
  onSecondaryMonthChange: (month: string) => void,
  onSwapMonths: () => void,
  onSyncWithSelectedMonth: () => void,
  onRefreshCompare: () => void,
  onCompareSortModeChange: (mode: CompareSortMode) => void
) {
  const primaryLabel = getSelectedMonthLabel(primaryMonth);
  const secondaryLabel = getSelectedMonthLabel(secondaryMonth);
  const primaryMetrics = buildCompareMonthMetrics(primaryState.tickets, primaryState.summary);
  const secondaryMetrics = buildCompareMonthMetrics(secondaryState.tickets, secondaryState.summary);
  const categoryRows = buildCategoryCompareRows(
    primaryState.tickets,
    secondaryState.tickets,
    compareSortMode
  );
  const budgetRows = ticketsFinancePreset.budgetLines
    .map((line) => {
      const primaryLine = primaryMetrics.budgetLines.find((item) => item.key === line.key);
      const secondaryLine = secondaryMetrics.budgetLines.find((item) => item.key === line.key);
      const primaryActual = primaryLine?.actual ?? 0;
      const secondaryActual = secondaryLine?.actual ?? 0;

      return {
        key: line.key,
        label: line.label,
        planned: line.planned,
        primaryActual,
        secondaryActual,
        delta: primaryActual - secondaryActual,
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  const totalDelta = primaryMetrics.total - secondaryMetrics.total;
  const remainingDelta = primaryMetrics.currentRemaining - secondaryMetrics.currentRemaining;
  const totalDeltaTone = getBudgetDifferenceTone(totalDelta);
  const remainingDeltaTone =
    remainingDelta > 0.009 ? "ok" : remainingDelta < -0.009 ? "warn" : "neutral";
  const sameMonth = primaryMonth === secondaryMonth;
  const compareLoading = primaryState.loading || secondaryState.loading;
  const primaryReady = primaryState.syncedAt !== null || Boolean(primaryState.error);
  const secondaryReady = secondaryState.syncedAt !== null || Boolean(secondaryState.error);
  const pairReady = primaryReady && secondaryReady;
  const categoriesWithMovement = categoryRows.filter((row) => row.absoluteDelta > 0.009).length;
  const topIncrease =
    [...categoryRows]
      .filter((row) => row.delta > 0.009)
      .sort((left, right) => right.delta - left.delta)[0] ?? null;
  const topDecrease =
    [...categoryRows]
      .filter((row) => row.delta < -0.009)
      .sort((left, right) => left.delta - right.delta)[0] ?? null;
  const newCategories = categoryRows.filter(
    (row) => row.secondaryAmount <= 0.009 && row.primaryAmount > 0.009
  );
  const missingCategories = categoryRows.filter(
    (row) => row.primaryAmount <= 0.009 && row.secondaryAmount > 0.009
  );
  const subscriptionsTotal = subscriptions.reduce((sum, item) => sum + item.amount, 0);
  const subscriptionsSharePrimary =
    primaryMetrics.total > 0 ? Math.round((subscriptionsTotal / primaryMetrics.total) * 100) : 0;
  const subscriptionsShareSecondary =
    secondaryMetrics.total > 0 ? Math.round((subscriptionsTotal / secondaryMetrics.total) * 100) : 0;
  const maxAbsoluteDelta = categoryRows.reduce(
    (max, row) => Math.max(max, row.absoluteDelta),
    0
  );

  const getSyncLabel = (state: CompareMonthState) => {
    if (state.loading && state.syncedAt === null) {
      return "Chargement...";
    }

    if (state.loading) {
      return "Actualisation...";
    }

    if (!state.syncedAt) {
      return "En attente";
    }

    return <LiveRelativeSyncLabel syncedAt={state.syncedAt} />;
  };

  const getMonthLeadClass = (monthTotal: number, otherMonthTotal: number) => {
    if (monthTotal > otherMonthTotal + 0.009) return "lead";
    if (monthTotal < otherMonthTotal - 0.009) return "trail";
    return "neutral";
  };

  const totalDeltaCardClass =
    totalDeltaTone === "warn"
      ? "accent-salmon"
      : totalDeltaTone === "ok"
        ? "accent-mint"
        : "accent-blue";
  const remainingDeltaCardClass =
    remainingDeltaTone === "ok"
      ? "accent-mint"
      : remainingDeltaTone === "warn"
        ? "accent-salmon"
        : "accent-gold";
  const selectedMonthLabel = getSelectedMonthLabel(selectedMonth);

  return (
    <>
      <section className="topbar compare-topbar">
        <div>
          <span className="eyebrow">Comparaison live</span>
          <h1>Comparateur mensuel</h1>
          <p>
            Mets deux mois face a face pour voir ce qui grimpe, ce qui se calme
            et quelles categories changent vraiment la physionomie du budget.
          </p>
        </div>

        <div className="topbar-actions compare-topbar-actions">
          <label className="compare-select-card">
            <span>Mois A</span>
            <select
              className="field-input"
              value={primaryMonth}
              onChange={(event) => onPrimaryMonthChange(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={`compare-primary-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="ghost-btn compare-swap-btn" onClick={onSwapMonths}>
            Inverser
          </button>

          <label className="compare-select-card">
            <span>Mois B</span>
            <select
              className="field-input"
              value={secondaryMonth}
              onChange={(event) => onSecondaryMonthChange(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={`compare-secondary-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="ghost-btn" onClick={onSyncWithSelectedMonth}>
            Utiliser {selectedMonthLabel}
          </button>

          <button type="button" className="outline-btn" onClick={onRefreshCompare}>
            {compareLoading ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </section>

      {sameMonth ? (
        <div className="status info compare-inline-banner">
          Tu compares actuellement {primaryLabel.toLowerCase()} avec le meme mois.
          Choisis une autre periode pour faire ressortir les ecarts.
        </div>
      ) : null}

      {compareLoading ? (
        <div className="status info compare-inline-banner">
          Le comparateur recharge les donnees des deux mois.
        </div>
      ) : null}

      {primaryState.error ? (
        <div className="status warn compare-inline-banner">
          {primaryLabel}: {primaryState.error}
        </div>
      ) : null}

      {secondaryState.error ? (
        <div className="status warn compare-inline-banner">
          {secondaryLabel}: {secondaryState.error}
        </div>
      ) : null}

      <section className="stats-grid compare-stats-grid">
        <article className={`card ${totalDeltaCardClass}`}>
          <span className="card-label">Delta depenses</span>
          <strong className={`card-value compare-card-delta ${totalDeltaTone}`}>
            {pairReady ? formatBudgetDifference(totalDelta) : "..."}
          </strong>
          <span className="card-sub">
            {sameMonth
              ? "Selection identique pour le moment."
              : totalDelta > 0.009
                ? `${primaryLabel} coute plus cher que ${secondaryLabel}.`
                : totalDelta < -0.009
                  ? `${primaryLabel} est plus leger que ${secondaryLabel}.`
                  : "Les deux mois restent tres proches."}
          </span>
        </article>

        <article className="card accent-blue">
          <span className="card-label">Ticket moyen</span>
          <strong className="card-value">
            {pairReady ? euro.format(primaryMetrics.averageTicket) : "..."}
          </strong>
          <span className="card-sub">
            {pairReady
              ? `${primaryLabel} vs ${euro.format(secondaryMetrics.averageTicket)} sur ${secondaryLabel}`
              : "Calcul en cours"}
          </span>
        </article>

        <article className={`card ${remainingDeltaCardClass}`}>
          <span className="card-label">Reste en cours</span>
          <strong className={`card-value compare-card-delta ${remainingDeltaTone}`}>
            {pairReady ? formatBudgetDifference(remainingDelta) : "..."}
          </strong>
          <span className="card-sub">
            {pairReady
              ? `${euro.format(primaryMetrics.currentRemaining)} vs ${euro.format(secondaryMetrics.currentRemaining)}`
              : "Synthese Sheets en attente"}
          </span>
        </article>

        <article className="card accent-rose">
          <span className="card-label">Categories en mouvement</span>
          <strong className="card-value">
            {pairReady ? String(categoriesWithMovement) : "..."}
          </strong>
          <span className="card-sub">
            {topIncrease
              ? `${topIncrease.category} mene la variation.`
              : "Aucun ecart categorie detecte pour le moment."}
          </span>
        </article>
      </section>

      <section className="content-grid compare-overview-grid">
        <article className="panel compare-duel-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Face a face</span>
              <h2>Duel des mois</h2>
            </div>
          </div>

          <div className="panel-body compare-duel-body">
            <div
              className={`compare-month-card ${getMonthLeadClass(primaryMetrics.total, secondaryMetrics.total)}`}
            >
              <div className="compare-month-card-head">
                <div>
                  <span className="panel-kicker">Mois A</span>
                  <strong>{primaryLabel}</strong>
                </div>
                <span className="compare-month-sync">{getSyncLabel(primaryState)}</span>
              </div>

              <strong className="compare-month-total">
                {primaryReady ? euro.format(primaryMetrics.total) : "..."}
              </strong>

              <div className="compare-month-meta">
                <span>{primaryReady ? `${primaryMetrics.ticketCount} ticket(s)` : "..."}</span>
                <span>{primaryReady ? `${Math.round(primaryMetrics.sentRatio)}% envoyes` : "..."}</span>
              </div>

              <div className="compare-month-progress">
                <div className="compare-month-progress-head">
                  <span>Budget utilise</span>
                  <strong>
                    {primaryReady ? `${Math.round(primaryMetrics.budgetUsagePercent)}%` : "..."}
                  </strong>
                </div>
                <div className="compare-month-track">
                  <div
                    className={`compare-month-fill ${primaryMetrics.budgetUsagePercent > 85 ? "warn" : "ok"}`}
                    style={{ width: `${primaryReady ? primaryMetrics.budgetUsagePercent : 0}%` }}
                  />
                </div>
              </div>

              <div className="compare-month-note">
                <span>Ticket marquant</span>
                <strong>
                  {primaryMetrics.largestTicket
                    ? `${primaryMetrics.largestTicket.description || "Sans description"} • ${euro.format(primaryMetrics.largestTicket.amount)}`
                    : "Aucun ticket pour ce mois"}
                </strong>
                <p>
                  {primaryMetrics.largestTicket
                    ? `${primaryMetrics.largestTicket.category || "Sans categorie"} • ${primaryMetrics.largestTicket.date || "Date indisponible"}`
                    : "La comparaison reste disponible meme sur un mois vide."}
                </p>
              </div>
            </div>

            <div className="compare-vs-pill">
              <span>Delta global</span>
              <strong className={totalDeltaTone}>
                {pairReady ? formatBudgetDifference(totalDelta) : "..."}
              </strong>
              <p>{primaryLabel} vs {secondaryLabel}</p>
            </div>

            <div
              className={`compare-month-card ${getMonthLeadClass(secondaryMetrics.total, primaryMetrics.total)}`}
            >
              <div className="compare-month-card-head">
                <div>
                  <span className="panel-kicker">Mois B</span>
                  <strong>{secondaryLabel}</strong>
                </div>
                <span className="compare-month-sync">{getSyncLabel(secondaryState)}</span>
              </div>

              <strong className="compare-month-total">
                {secondaryReady ? euro.format(secondaryMetrics.total) : "..."}
              </strong>

              <div className="compare-month-meta">
                <span>{secondaryReady ? `${secondaryMetrics.ticketCount} ticket(s)` : "..."}</span>
                <span>{secondaryReady ? `${Math.round(secondaryMetrics.sentRatio)}% envoyes` : "..."}</span>
              </div>

              <div className="compare-month-progress">
                <div className="compare-month-progress-head">
                  <span>Budget utilise</span>
                  <strong>
                    {secondaryReady ? `${Math.round(secondaryMetrics.budgetUsagePercent)}%` : "..."}
                  </strong>
                </div>
                <div className="compare-month-track">
                  <div
                    className={`compare-month-fill ${secondaryMetrics.budgetUsagePercent > 85 ? "warn" : "ok"}`}
                    style={{ width: `${secondaryReady ? secondaryMetrics.budgetUsagePercent : 0}%` }}
                  />
                </div>
              </div>

              <div className="compare-month-note">
                <span>Ticket marquant</span>
                <strong>
                  {secondaryMetrics.largestTicket
                    ? `${secondaryMetrics.largestTicket.description || "Sans description"} • ${euro.format(secondaryMetrics.largestTicket.amount)}`
                    : "Aucun ticket pour ce mois"}
                </strong>
                <p>
                  {secondaryMetrics.largestTicket
                    ? `${secondaryMetrics.largestTicket.category || "Sans categorie"} • ${secondaryMetrics.largestTicket.date || "Date indisponible"}`
                    : "Tu peux garder ce mois comme point de comparaison neutre."}
                </p>
              </div>
            </div>
          </div>
        </article>

        <article className="panel compare-insights-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Lecture rapide</span>
              <h2>Ce qui change</h2>
            </div>
          </div>

          <div className="panel-body stack compare-insights-list">
            <div className="activity-item simple compare-insight-item">
              <div>
                <strong>
                  {topIncrease ? `Hausse la plus visible: ${topIncrease.category}` : "Aucune hausse marquante"}
                </strong>
                <span>
                  {topIncrease
                    ? `${primaryLabel} depense ${formatBudgetDifference(topIncrease.delta)} de plus que ${secondaryLabel}.`
                    : "Aucune categorie ne tire franchement le budget vers le haut."}
                </span>
              </div>
            </div>

            <div className="activity-item simple compare-insight-item">
              <div>
                <strong>
                  {topDecrease ? `Baisse la plus nette: ${topDecrease.category}` : "Aucune baisse marquante"}
                </strong>
                <span>
                  {topDecrease
                    ? `${primaryLabel} economise ${formatBudgetDifference(Math.abs(topDecrease.delta))} sur ce poste.`
                    : "Le niveau de depense reste proche sur les categories actives."}
                </span>
              </div>
            </div>

            <div className="activity-item simple compare-insight-item">
              <div>
                <strong>
                  {newCategories.length > 0
                    ? `${newCategories.length} nouvelle(s) categorie(s) sur ${primaryLabel}`
                    : `Aucune nouvelle categorie sur ${primaryLabel}`}
                </strong>
                <span>
                  {newCategories.length > 0
                    ? newCategories.slice(0, 3).map((row) => row.category).join(" • ")
                    : `${primaryLabel} conserve les memes grandes familles que ${secondaryLabel}.`}
                </span>
              </div>
            </div>

            <div className="activity-item simple compare-insight-item">
              <div>
                <strong>
                  {missingCategories.length > 0
                    ? `${missingCategories.length} categorie(s) absente(s) sur ${primaryLabel}`
                    : `Aucune categorie ne disparait sur ${primaryLabel}`}
                </strong>
                <span>
                  {missingCategories.length > 0
                    ? missingCategories.slice(0, 3).map((row) => row.category).join(" • ")
                    : "Le panorama de depenses reste complet d un mois a l autre."}
                </span>
              </div>
            </div>

            <div className="activity-item simple compare-insight-item">
              <div>
                <strong>
                  {subscriptionsTotal > 0
                    ? `${euro.format(subscriptionsTotal)}/mois d abonnements actifs aujourd hui`
                    : "Aucun abonnement actif en memoire locale"}
                </strong>
                <span>
                  {subscriptionsTotal > 0
                    ? `Si tu les reconduis a l identique, cela pese ${subscriptionsSharePrimary}% de ${primaryLabel.toLowerCase()} et ${subscriptionsShareSecondary}% de ${secondaryLabel.toLowerCase()}.`
                    : "Ajoute des abonnements dans le dashboard pour lire aussi leur poids mensuel ici."}
                </span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="panel compare-table-panel">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">{categoryRows.length} categorie(s) comparee(s)</span>
            <h2>Ecarts par categorie</h2>
          </div>

          <div className="compare-sort-pills">
            <button
              type="button"
              className={`compare-sort-pill ${compareSortMode === "delta" ? "active" : ""}`}
              onClick={() => onCompareSortModeChange("delta")}
            >
              Ecart
            </button>
            <button
              type="button"
              className={`compare-sort-pill ${compareSortMode === "primary" ? "active" : ""}`}
              onClick={() => onCompareSortModeChange("primary")}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className={`compare-sort-pill ${compareSortMode === "secondary" ? "active" : ""}`}
              onClick={() => onCompareSortModeChange("secondary")}
            >
              {secondaryLabel}
            </button>
          </div>
        </div>

        <div className="panel-body">
          {categoryRows.length === 0 ? (
            <div className="status info">
              Les categories apparaitront ici des que les deux mois auront des donnees a comparer.
            </div>
          ) : (
            <div className="compare-table">
              <div className="compare-table-head">
                <span>Categorie</span>
                <span>{primaryLabel}</span>
                <span>{secondaryLabel}</span>
                <span>Ecart</span>
                <span>Impact</span>
              </div>

              {categoryRows.slice(0, 12).map((row) => {
                const tone = getBudgetDifferenceTone(row.delta);
                const impactWidth =
                  maxAbsoluteDelta > 0
                    ? Math.max(6, (row.absoluteDelta / maxAbsoluteDelta) * 100)
                    : 0;

                return (
                  <div className="compare-table-row" key={`compare-row-${row.category}`}>
                    <div className="compare-table-category">
                      <strong>{row.category}</strong>
                      <span>
                        {row.primaryCount} ticket(s) vs {row.secondaryCount}
                      </span>
                    </div>

                    <span className="compare-table-value">{euro.format(row.primaryAmount)}</span>
                    <span className="compare-table-value">{euro.format(row.secondaryAmount)}</span>
                    <span className={`compare-table-delta ${tone}`}>
                      {formatBudgetDifference(row.delta)}
                    </span>

                    <div className="compare-impact-cell">
                      <div className="compare-impact-track">
                        <div
                          className={`compare-impact-fill ${tone}`}
                          style={{ width: `${impactWidth}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="content-grid compare-detail-grid">
        <article className="panel compare-budget-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Budget cible</span>
              <h2>Lignes sous tension</h2>
            </div>
          </div>

          <div className="panel-body compare-budget-list">
            {budgetRows.slice(0, 6).map((row) => {
              const tone = getBudgetDifferenceTone(row.delta);

              return (
                <div className="compare-budget-row" key={`compare-budget-${row.key}`}>
                  <div className="compare-budget-main">
                    <strong>{row.label}</strong>
                    <div className="compare-budget-values">
                      <span className="compare-budget-chip">Cible {euro.format(row.planned)}</span>
                      <span className="compare-budget-chip">{primaryLabel} {euro.format(row.primaryActual)}</span>
                      <span className="compare-budget-chip">{secondaryLabel} {euro.format(row.secondaryActual)}</span>
                    </div>
                  </div>

                  <strong className={`compare-budget-delta ${tone}`}>
                    {formatBudgetDifference(row.delta)}
                  </strong>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel compare-notes-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Points fixes</span>
              <h2>Repere rapide</h2>
            </div>
          </div>

          <div className="panel-body stack compare-note-stack">
            <div className="compare-note-card">
              <span>Depense non prevue</span>
              <strong>
                {pairReady
                  ? `${primaryLabel}: ${formatBudgetDifference(primaryMetrics.unexpectedSpend)}`
                  : "Calcul en cours"}
              </strong>
              <p>
                {pairReady
                  ? `${secondaryLabel}: ${formatBudgetDifference(secondaryMetrics.unexpectedSpend)}`
                  : "Le delta reel vs theorique sera affiche ici."}
              </p>
            </div>

            <div className="compare-note-card">
              <span>Ticket marquant {primaryLabel}</span>
              <strong>
                {primaryMetrics.largestTicket
                  ? euro.format(primaryMetrics.largestTicket.amount)
                  : "Aucune depense"}
              </strong>
              <p>
                {primaryMetrics.largestTicket
                  ? `${primaryMetrics.largestTicket.description || "Sans description"} • ${primaryMetrics.largestTicket.category || "Sans categorie"}`
                  : "Ce mois ne contient pas encore de ticket a mettre en avant."}
              </p>
            </div>

            <div className="compare-note-card">
              <span>Ticket marquant {secondaryLabel}</span>
              <strong>
                {secondaryMetrics.largestTicket
                  ? euro.format(secondaryMetrics.largestTicket.amount)
                  : "Aucune depense"}
              </strong>
              <p>
                {secondaryMetrics.largestTicket
                  ? `${secondaryMetrics.largestTicket.description || "Sans description"} • ${secondaryMetrics.largestTicket.category || "Sans categorie"}`
                  : "Tu peux garder ce mois comme base neutre ou en choisir un autre."}
              </p>
            </div>

            <div className="compare-note-card">
              <span>Cadence de tickets</span>
              <strong>
                {pairReady
                  ? `${primaryMetrics.ticketCount} sur ${primaryLabel} vs ${secondaryMetrics.ticketCount} sur ${secondaryLabel}`
                  : "Lecture en attente"}
              </strong>
              <p>
                {pairReady
                  ? `${primaryMetrics.pendingCount} en attente sur ${primaryLabel}, ${secondaryMetrics.pendingCount} sur ${secondaryLabel}.`
                  : "Les volumes et les tickets en attente apparaitront ici."}
              </p>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function renderCollab(
  collabIdentity: CollabIdentity,
  collaborators: Collaborator[],
  sharedNote: string,
  collabStatus: string,
  collabError: string,
  collabFeed: CollabFeedItem[],
  collabSignals: CollabSignal[],
  followedPeerId: string,
  collabConnectionState: "connecting" | "live" | "unstable",
  onNameChange: (value: string) => void,
  onSharedNoteChange: (value: string) => void,
  onOpenSecondSession: () => void,
  onBoardPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void,
  onBoardPointerLeave: () => void,
  onSendSignal: (kind: CollabSignalKind) => void,
  onClearSharedNote: () => void,
  onFollowPeerChange: (peerId: string) => void
) {
  const activePeers = collaborators.filter((item) => Date.now() - item.lastSeen < collabPresenceTimeoutMs);
  const boardPeers = activePeers.filter((item) => item.insideBoard && item.page === "collab");
  const followedPeer =
    activePeers.find((item) => item.id === followedPeerId) || activePeers[0] || null;

  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Mode multi</span>
          <h1>Collab live enrichie</h1>
          <p>
            Presence, curseurs, reactions, suivi de session et journal live :
            la collab devient enfin lisible et utile en duo.
          </p>
        </div>
        <div className="topbar-actions">
          <label className="collab-name-card">
            <span>Ton nom live</span>
            <input
              className="field-input"
              type="text"
              value={collabIdentity.name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <button className="primary-btn" onClick={onOpenSecondSession}>
            Ouvrir une session 2
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card accent-blue">
          <span className="card-label">Ta session</span>
          <strong className="card-value">{collabIdentity.name}</strong>
          <span className="card-sub">Couleur live deja attribuee</span>
        </article>

        <article className="card accent-mint">
          <span className="card-label">Utilisateurs en ligne</span>
          <strong className="card-value">{activePeers.length + 1}</strong>
          <span className="card-sub">Toi compris, tous postes confondus</span>
        </article>

        <article className="card accent-gold">
          <span className="card-label">Curseurs visibles</span>
          <strong className="card-value">{boardPeers.length}</strong>
          <span className="card-sub">Dans la zone de collaboration</span>
        </article>

        <article className={`card ${collabConnectionState === "live" ? "accent-mint" : collabConnectionState === "unstable" ? "accent-salmon" : "accent-gold"}`}>
          <span className="card-label">Etat live</span>
          <strong className="card-value">
            {collabConnectionState === "live"
              ? "Connecte"
              : collabConnectionState === "unstable"
              ? "Instable"
              : "Connexion"}
          </strong>
          <span className="card-sub">Temps reel Supabase</span>
        </article>
      </section>

      <section className="content-grid collab-grid">
        <article className="panel collab-board-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Canvas partage</span>
              <h2>Zone curseurs et signaux</h2>
            </div>
            <div className="collab-legend">
              <span className="collab-dot" style={{ backgroundColor: collabIdentity.color }} />
              <strong>{collabIdentity.name}</strong>
            </div>
          </div>

          <div className="panel-body">
            <div className="ticket-modal-actions" style={{ marginBottom: 14 }}>
              <button type="button" className="ghost-btn" onClick={() => onSendSignal("ping")}>
                Ping
              </button>
              <button type="button" className="ghost-btn" onClick={() => onSendSignal("assist")}>
                Besoin d aide
              </button>
              <button type="button" className="ghost-btn" onClick={() => onSendSignal("celebrate")}>
                Bien joue
              </button>
              <button type="button" className="ghost-btn" onClick={() => onSendSignal("focus")}>
                Regarde ici
              </button>
            </div>

            <div
              className="collab-board"
              onPointerMove={onBoardPointerMove}
              onPointerLeave={onBoardPointerLeave}
            >
              <div className="collab-board-copy">
                <strong>Deplace ta souris ici</strong>
                <span>Les autres sessions voient le curseur et les signaux en direct.</span>
              </div>

              {boardPeers.map((peer) => (
                <div
                  key={`board-peer-${peer.id}`}
                  className="remote-cursor"
                  style={{
                    left: `${peer.cursorX}%`,
                    top: `${peer.cursorY}%`,
                  }}
                >
                  <div className="remote-cursor-pin" style={{ backgroundColor: peer.color }} />
                  <div className="remote-cursor-tag" style={{ borderColor: peer.color }}>
                    <span className="collab-dot" style={{ backgroundColor: peer.color }} />
                    <strong>{peer.name}</strong>
                  </div>
                </div>
              ))}

              {collabSignals.map((signal) => (
                <div
                  key={signal.id}
                  className="remote-cursor"
                  style={{
                    left: `${signal.x}%`,
                    top: `${signal.y}%`,
                    pointerEvents: "none",
                  }}
                >
                  <div
                    className="remote-cursor-tag"
                    style={{
                      borderColor: signal.color,
                      background: "rgba(15, 18, 28, 0.92)",
                    }}
                  >
                    <span className="collab-dot" style={{ backgroundColor: signal.color }} />
                    <strong>{signal.emoji} {signal.label}</strong>
                    <span>{signal.author}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Presence</span>
              <h2>Sessions connectees</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="collab-presence-card self">
              <div className="collab-presence-row">
                <span className="collab-dot" style={{ backgroundColor: collabIdentity.color }} />
                <strong>{collabIdentity.name}</strong>
              </div>
              <span>Toi • {getPageLabel("collab")}</span>
            </div>

            {activePeers.map((peer) => (
              <button
                type="button"
                className={`collab-presence-card ${followedPeerId === peer.id ? "active" : ""}`}
                key={peer.id}
                onClick={() => onFollowPeerChange(peer.id)}
                style={{ textAlign: "left" }}
              >
                <div className="collab-presence-row">
                  <span className="collab-dot" style={{ backgroundColor: peer.color }} />
                  <strong>{peer.name}</strong>
                </div>
                <span>
                  {getPageLabel(peer.page)}
                  {peer.context ? ` • ${peer.context}` : ""}
                </span>
                <span>Vu {formatPresenceAge(peer.lastSeen)}</span>
                {peer.focusTicketLabel ? <span>{peer.focusTicketLabel}</span> : null}
              </button>
            ))}

            {activePeers.length === 0 ? (
              <div className="status info">
                Connecte un autre compte ou ouvre une autre session pour voir la presence distante.
              </div>
            ) : null}

            {collabStatus ? <div className="status ok">{collabStatus}</div> : null}
            {collabError ? <div className="status warn">{collabError}</div> : null}
          </div>
        </article>
      </section>

      <section className="content-grid collab-grid-lower">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Bloc note partage</span>
              <h2>Texte synchro en direct</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <textarea
              data-history-global="true"
              className="collab-note-input"
              value={sharedNote}
              onChange={(event) => onSharedNoteChange(event.target.value)}
              placeholder="Ecris ici depuis une session et regarde l autre se mettre a jour."
            />
            <div className="ticket-modal-actions">
              <button type="button" className="ghost-btn" onClick={onClearSharedNote}>
                Vider le bloc-note
              </button>
            </div>
            <div className="mini-note">
              Cette version passe par ton backend Apps Script + Supabase pour faire vivre la collab.
            </div>
          </div>
        </article>

        <article className="panel spotlight-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Spotlight session</span>
              <h2>Session suivie</h2>
            </div>
          </div>

          <div className="panel-body stack">
            {followedPeer ? (
              <>
                <div className="activity-item simple">
                  <div>
                    <strong>{followedPeer.name}</strong>
                    <span>
                      {getPageLabel(followedPeer.page)}
                      {followedPeer.context ? ` • ${followedPeer.context}` : ""}
                    </span>
                  </div>
                </div>
                <div className="status info">Derniere activite: {formatPresenceAge(followedPeer.lastSeen)}</div>
                {followedPeer.focusTicketLabel ? (
                  <div className="status ok">Focus en cours: {followedPeer.focusTicketLabel}</div>
                ) : (
                  <div className="status info">Aucun ticket mis en focus pour l instant.</div>
                )}
              </>
            ) : (
              <div className="status info">Aucune session distante a suivre pour l instant.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Activite live</span>
              <h2>Journal de session</h2>
            </div>
          </div>

          <div className="panel-body stack">
            {collabFeed.length === 0 ? (
              <div className="status info">Aucun evenement live pour le moment.</div>
            ) : (
              collabFeed.map((item) => (
                <div className={`status ${item.tone}`} key={item.id}>
                  <span className="collab-dot" style={{ backgroundColor: item.color, marginRight: 8 }} />
                  {item.text}
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function renderPlaceholder(page: PageKey) {
  const meta = pageMeta[page];

  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Module</span>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
        <button className="primary-btn">{meta.action}</button>
      </section>

      <section className="content-grid placeholder-grid">
        <article className="panel spotlight-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Prochaine etape</span>
              <h2>Module en preparation</h2>
            </div>
          </div>
          <div className="panel-body stack">
            <p className="spotlight-copy">
              La structure est prete pour accueillir ce module sans refaire toute l application.
              Tu as deja une base saine pour brancher la logique metier.
            </p>
            <div className="status info">
              Astuce: ce bloc peut devenir une checklist produit ou technique.
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Idees de contenu</span>
              <h2>Elements a ajouter</h2>
            </div>
          </div>
          <div className="panel-body stack">
            <div className="activity-item simple">
              <div>
                <strong>Table principale</strong>
                <span>Liste filtrable, tris et recherche locale.</span>
              </div>
            </div>
            <div className="activity-item simple">
              <div>
                <strong>Panneau de synthese</strong>
                <span>KPIs, alertes, indicateurs et export rapide.</span>
              </div>
            </div>
            <div className="activity-item simple">
              <div>
                <strong>Actions desktop</strong>
                <span>Tauri, stockage local et raccourcis clavier.</span>
              </div>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function renderAuthScreen(
  mode: AuthMode,
  signInForm: SignInForm,
  signUpForm: SignUpForm,
  loading: boolean,
  status: string,
  error: string,
  onModeChange: (mode: AuthMode) => void,
  onSignInChange: (patch: Partial<SignInForm>) => void,
  onSignUpChange: (patch: Partial<SignUpForm>) => void,
  onSignIn: () => void,
  onSignUp: () => void
) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-hero">
          <div className="brand">
            <div className="brand-logo">
              <img src="/budget-pc-logo.svg" alt="Budget PC" className="brand-logo-image" />
            </div>
            <div>
              <div className="brand-title">Budget PC</div>
              <div className="brand-sub">Espace perso desktop</div>
            </div>
          </div>

          <span className="eyebrow">Connexion</span>
          <h1>Un vrai compte pour ton budget, ton profil et ton mode multi.</h1>
          <p>
            Cree ton acces avec ton mail, ton nom et la couleur de curseur qui te
            representera ensuite dans la collab.
          </p>

          <div className="auth-benefits">
            <div className="status info">Compte distant persistant meme apres reinstallation.</div>
            <div className="status info">Couleur du curseur deja prete pour le multi.</div>
            <div className="status info">Connexion email et mot de passe depuis n importe quel PC.</div>
          </div>
        </div>

        <div className="auth-panel">
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${mode === "signin" ? "active" : ""}`}
              onClick={() => onModeChange("signin")}
            >
              Se connecter
            </button>
            <button
              type="button"
              className={`auth-tab ${mode === "signup" ? "active" : ""}`}
              onClick={() => onModeChange("signup")}
            >
              S inscrire
            </button>
          </div>

          {mode === "signin" ? (
            <div className="auth-form">
              <label className="field-block">
                <span>Email</span>
                <input
                  className="field-input"
                  type="email"
                  value={signInForm.email}
                  onChange={(event) => onSignInChange({ email: event.target.value })}
                  placeholder="prenom.nom@email.com"
                />
              </label>

              <label className="field-block">
                <span>Mot de passe</span>
                <input
                  className="field-input"
                  type="password"
                  value={signInForm.password}
                  onChange={(event) => onSignInChange({ password: event.target.value })}
                  placeholder="Ton mot de passe"
                />
              </label>

              {status ? <div className="status ok">{status}</div> : null}
              {error ? <div className="status warn">{error}</div> : null}

              <button type="button" className="primary-btn auth-submit" onClick={onSignIn} disabled={loading}>
                {loading ? "Connexion..." : "Entrer dans l app"}
              </button>
            </div>
          ) : (
            <div className="auth-form">
              <div className="auth-grid">
                <label className="field-block">
                  <span>Prenom</span>
                  <input
                    className="field-input"
                    type="text"
                    value={signUpForm.firstName}
                    onChange={(event) => onSignUpChange({ firstName: event.target.value })}
                    placeholder="Jean"
                  />
                </label>

                <label className="field-block">
                  <span>Nom</span>
                  <input
                    className="field-input"
                    type="text"
                    value={signUpForm.lastName}
                    onChange={(event) => onSignUpChange({ lastName: event.target.value })}
                    placeholder="Dupont"
                  />
                </label>
              </div>

              <label className="field-block">
                <span>Email</span>
                <input
                  className="field-input"
                  type="email"
                  value={signUpForm.email}
                  onChange={(event) => onSignUpChange({ email: event.target.value })}
                  placeholder="prenom.nom@email.com"
                />
              </label>

              <label className="field-block">
                <span>Pseudo</span>
                <input
                  className="field-input"
                  type="text"
                  value={signUpForm.pseudo}
                  onChange={(event) => onSignUpChange({ pseudo: event.target.value })}
                  placeholder="Ton pseudo visible dans l app"
                />
              </label>

              <div className="auth-grid">
                <label className="field-block">
                  <span>Mot de passe</span>
                  <input
                    className="field-input"
                    type="password"
                    value={signUpForm.password}
                    onChange={(event) => onSignUpChange({ password: event.target.value })}
                    placeholder="Choisis un mot de passe"
                  />
                </label>

                <label className="field-block">
                  <span>Confirmation</span>
                  <input
                    className="field-input"
                    type="password"
                    value={signUpForm.confirmPassword}
                    onChange={(event) => onSignUpChange({ confirmPassword: event.target.value })}
                    placeholder="Retape le mot de passe"
                  />
                </label>
              </div>

              <div className="field-block">
                <span>Couleur du curseur</span>
                <div className="color-choice-row">
                  {collabColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-choice ${signUpForm.cursorColor === color ? "active" : ""}`}
                      style={{ backgroundColor: color }}
                      onClick={() => onSignUpChange({ cursorColor: color })}
                      aria-label={`Choisir ${color}`}
                    />
                  ))}
                </div>
              </div>

              {status ? <div className="status ok">{status}</div> : null}
              {error ? <div className="status warn">{error}</div> : null}

              <button type="button" className="primary-btn auth-submit" onClick={onSignUp} disabled={loading}>
                {loading ? "Creation..." : "Creer mon compte"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderSettings(
  account: AccountProfile,
  form: AccountSettingsForm,
  profileLoading: boolean,
  profileStatus: string,
  profileError: string,
  onChange: (patch: Partial<AccountSettingsForm>) => void,
  onSaveQuick: () => void,
  onSaveFull: () => void,
  onLogout: () => void
) {
  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Compte</span>
          <h1>Parametres</h1>
          <p>Gere ton pseudo, ta couleur et ton compte.</p>
        </div>
        <div className="topbar-actions">
          <span className="sync-badge">{getAccountDisplayName(account)}</span>
          <button className="ghost-btn" onClick={onLogout}>
            Se deconnecter
          </button>
        </div>
      </section>

      <section className="content-grid">
        <article className={`panel settings-appearance-panel${profileLoading ? " settings-appearance-saving" : ""}`}>

          {profileLoading ? (
            <div className="settings-appearance-overlay">
              <div className="card-loader-shell">
                <div className="card-loader">
                  <span className="card-loader-ring" />
                  <span className="card-loader-orbit" />
                  <span className="card-loader-core" />
                </div>
              </div>
              <span className="settings-appearance-saving-label">Enregistrement...</span>
            </div>
          ) : null}

          <div className="panel-head">
            <div>
              <span className="panel-kicker">Apparence</span>
              <h2>Pseudo et couleur</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <label className="field-block">
              <span>Pseudo</span>
              <input
                className="field-input"
                type="text"
                value={form.pseudo}
                onChange={(event) => onChange({ pseudo: event.target.value })}
                placeholder="Ton pseudo visible par tous"
              />
            </label>

            <div className="field-block">
              <span>Couleur du curseur</span>
              <div className="color-choice-row">
                {collabColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-choice ${form.cursorColor === color ? "active" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => onChange({ cursorColor: color })}
                    aria-label={`Choisir ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="settings-preview-row">
              <span className="collab-dot" style={{ backgroundColor: form.cursorColor }} />
              <span className="settings-preview-name">{form.pseudo || getAccountDisplayName(account)}</span>
            </div>

            {profileStatus ? <div className="status ok">{profileStatus}</div> : null}
            {profileError ? <div className="status warn">{profileError}</div> : null}

            <div className="ticket-modal-actions">
              <button className="primary-btn" onClick={onSaveQuick} disabled={profileLoading}>
                Sauvegarder
              </button>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Compte</span>
              <h2>Identite et securite</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="auth-grid">
              <label className="field-block">
                <span>Prenom</span>
                <input
                  className="field-input"
                  type="text"
                  value={form.firstName}
                  onChange={(event) => onChange({ firstName: event.target.value })}
                />
              </label>

              <label className="field-block">
                <span>Nom</span>
                <input
                  className="field-input"
                  type="text"
                  value={form.lastName}
                  onChange={(event) => onChange({ lastName: event.target.value })}
                />
              </label>
            </div>

            <label className="field-block">
              <span>Email</span>
              <input
                className="field-input"
                type="email"
                value={form.email}
                onChange={(event) => onChange({ email: event.target.value })}
              />
            </label>

            <label className="field-block">
              <span>Mot de passe actuel</span>
              <input
                className="field-input"
                type="password"
                value={form.currentPassword}
                onChange={(event) => onChange({ currentPassword: event.target.value })}
                placeholder="Requis pour modifier cette section"
              />
            </label>

            <div className="auth-grid">
              <label className="field-block">
                <span>Nouveau mot de passe</span>
                <input
                  className="field-input"
                  type="password"
                  value={form.newPassword}
                  onChange={(event) => onChange({ newPassword: event.target.value })}
                  placeholder="Optionnel"
                />
              </label>

              <label className="field-block">
                <span>Confirmation</span>
                <input
                  className="field-input"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) => onChange({ confirmPassword: event.target.value })}
                  placeholder="Retape le nouveau mdp"
                />
              </label>
            </div>

            <div className="ticket-modal-actions">
              <button className="primary-btn" onClick={onSaveFull} disabled={profileLoading}>
                {profileLoading ? "Enregistrement..." : "Modifier le compte"}
              </button>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

const patchNotesData: { version: string; date: string; notes: string[] }[] = [
  {
    version: "0.1.23",
    date: "2026-04-23",
    notes: [
      "- Import CSV bancaire : nouvelle fonctionnalité d'import des dépenses directement depuis un relevé de compte (en cours de finalisation)",
      "- Indicateur de chargement animé lors du changement de mois, cohérent avec le thème de l'app",
      "- Historique des notifications persistant entre les sessions — visible même si l'autre utilisateur n'a pas l'app ouverte ⚠️ *Connu : supprimer une notification, fermer puis rouvrir l'app la fait réapparaître — correctif prévu*",
      "- Refonte visuelle des blocs Remboursements et Tickets : indicateurs de chargement stylés sur chaque étape (suppression, ajout, retour arrière Ctrl+Z), l'overlay reste affiché jusqu'à ce que les nouvelles données soient bien synchronisées",
      "- Page Version : alignement homogène de tous les blocs et taille de texte agrandie pour une meilleure lisibilité",
      "- Paramètres — Apparence : palette de couleurs de profil étendue avec davantage de teintes disponibles, et overlay de chargement animé lors de la sauvegarde du pseudo ou de la couleur",
    ],
  },
  {
    version: "0.1.22",
    date: "2026-04-22",
    notes: [
      "Refonte de l'affichage de synchronisation (temps reel depuis la derniere actualisation)",
      "Correction des valeurs affichees dans les cartes (coherence des donnees restauree)",
      "Amelioration du rendu global du dashboard (espacement, lisibilite, structure, fonds des cadres)",
      "Cadre Audit initialise (base fonctionnelle en place)",
      "Depenses non prevues desormais cliquables (acces au detail)",
      "Comparateur fonctionnel (a peaufiner)",
      "Suppression des sous-titres dans les cartes solde / reste en cours / reste theorique / depenses non prevues",
      "Tickets : ajout du bouton Vue feuille pour acces rapide a l'ensemble des tickets",
    ],
  },
  {
    version: "0.1.21",
    date: "2026-04-22",
    notes: [
      "Correction et amelioration de l'affichage des cartes Courses et Essence sur le dashboard",
      "Amelioration du menu Admin (ergonomie, gestion des roles, acces, a ameliorer)",
      "Modification du systeme de tickets (ajout, edition, suivi)",
      "Ajout de la creation de ticket (fonctionnelle mais a ameliorer)",
      "Divers correctifs et ajustements visuels",
    ],
  },
  {
    version: "0.1.20",
    date: "2026-04-14",
    notes: [
      "Nouveau panel Admin reserve aux comptes autorises",
      "Gestion des comptes: email, prenom, nom, pseudo, couleur, role",
      "Promotion et retrait du statut admin pour les co-gerants",
      "Blocage d acces a la page Admin pour les comptes non autorises",
      "Ajout du compteur en ligne cliquable avec popup des utilisateurs connectes",
      "Refonte visuelle du dashboard (cartes Courses / Essence et alignements)",
      "Mise a jour backend comptes: role admin/user + sessionToken + actions admin",
    ],
  },
  {
    version: "0.1.19",
    date: "2026-04-14",
    notes: [
      "Correction de l affichage Invalid Date sur l ecran de mise a jour",
    ],
  },
  {
    version: "0.1.18",
    date: "2026-04-14",
    notes: [
      "Correction de l ordre des derniers tickets sur le dashboard (les plus recents en premier)",
    ],
  },
  {
    version: "0.1.17",
    date: "2026-04-14",
    notes: [
      "Mise a jour obligatoire : overlay bloquant si une MAJ est disponible",
      "Verification automatique des mises a jour toutes les 5 minutes",
      "Redemarrage automatique apres installation de la mise a jour",
      "Nouvelle page Version avec patch notes et selecteur de version",
      "Suppression du bandeau de mise a jour optionnel",
    ],
  },
  {
    version: "0.1.16",
    date: "2025-06-01",
    notes: [
      "Ajout de la page Version avec patch notes",
      "Synchronisation des abonnements entre utilisateurs",
      "Correction du curseur collaboratif avec le scroll",
      "Historique separe App / Google Sheets en deux colonnes",
      "Validation du formulaire d ajout d abonnement",
      "Effets hover/active sur les boutons modaux",
    ],
  },
  {
    version: "0.1.15",
    date: "2025-05-25",
    notes: [
      "Systeme d abonnements dynamiques avec ajout/suppression",
      "Modale d ajout et de suppression d abonnement",
      "Toast et historique pour les actions abonnements",
      "Signaux collaboratifs (ping, assist, celebrate, focus)",
    ],
  },
  {
    version: "0.1.14",
    date: "2025-05-18",
    notes: [
      "Vue collaboration multi-utilisateurs en temps reel",
      "Curseurs distants avec couleur personnalisee",
      "Note partagee synchronisee entre pairs",
      "Badges de presence et liste des collaborateurs",
    ],
  },
  {
    version: "0.1.13",
    date: "2025-05-10",
    notes: [
      "Page Parametres avec profil et identite",
      "Sauvegarde du profil dans Supabase",
      "Choix de la couleur de curseur",
      "Deconnexion et gestion de session",
    ],
  },
  {
    version: "0.1.12",
    date: "2025-05-02",
    notes: [
      "Systeme de remboursements avec historique",
      "Undo/Redo pour les remboursements",
      "Export des tickets en CSV",
      "Ameliorations du dashboard",
    ],
  },
];

function renderAdminPage(
  currentAccount: AccountProfile,
  adminUsers: AccountProfile[],
  adminLoading: boolean,
  adminError: string,
  onLoadUsers: () => void,
  onToggleRole: (targetEmail: string, newRole: "admin" | "user") => void,
  handleOpenPermissions: (user: AccountProfile) => void,
  collaborators: Collaborator[],
  adminSearch: string,
  onAdminSearchChange: (v: string) => void,
  adminRoleFilter: "all" | "founder" | "admin" | "user",
  onAdminRoleFilterChange: (v: "all" | "founder" | "admin" | "user") => void
) {
  if (!isPrivileged(currentAccount)) {
    return (
      <section className="panel admin-blocked-panel">
        <div className="admin-blocked">
          <div className="admin-blocked-glow" />
          <span className="admin-blocked-icon">🔒</span>
          <h2>Zone reservee</h2>
          <p className="admin-blocked-desc">Cette section est uniquement accessible aux <strong>administrateurs</strong> et au <strong>fondateur</strong> de l'application.</p>
          <p className="admin-blocked-hint">Votre compte : <strong>{currentAccount.pseudo || currentAccount.email}</strong></p>
          <span className="admin-blocked-role">{currentAccount.role === "user" ? "Utilisateur" : currentAccount.role}</span>
        </div>
      </section>
    );
  }

  const totalUsers = adminUsers.length;
  const totalAdmins = adminUsers.filter((u) => u.role === "admin").length;
  const totalFounders = adminUsers.filter((u) => u.role === "founder").length;
  const onlineCount = collaborators.length + 1;
  const recentUsers = adminUsers.filter((u) => {
    if (!u.createdAt) return false;
    const diff = Date.now() - new Date(u.createdAt).getTime();
    return diff < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const searchLower = adminSearch.toLowerCase();
  const filteredUsers = adminUsers.filter((u) => {
    if (adminRoleFilter !== "all" && u.role !== adminRoleFilter) return false;
    if (!searchLower) return true;
    return (
      (u.pseudo || "").toLowerCase().includes(searchLower) ||
      (u.firstName || "").toLowerCase().includes(searchLower) ||
      (u.lastName || "").toLowerCase().includes(searchLower) ||
      u.email.toLowerCase().includes(searchLower)
    );
  });

  const isFounder = currentAccount.role === "founder";

  return (
    <div className="admin-panel-layout">
      <section className="admin-hero-panel">
        <div className="admin-hero-bg" />
        <div className="admin-hero-content">
          <div className="admin-hero-text">
            <span className="admin-hero-eyebrow">⚙️ Administration</span>
            <h1>Panneau d'administration</h1>
            <p>Gerez les comptes, roles et permissions de votre equipe.</p>
          </div>
          <button className="primary-btn admin-hero-refresh" onClick={onLoadUsers} disabled={adminLoading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            {adminLoading ? "Chargement..." : "Rafraichir"}
          </button>
        </div>
      </section>

      {adminError && <div className="admin-error admin-error-bar">{adminError}</div>}

      <section className="admin-stats-row">
        <div className="admin-stat-card">
          <span className="admin-stat-icon">👥</span>
          <div className="admin-stat-body">
            <span className="admin-stat-value">{totalUsers}</span>
            <span className="admin-stat-label">Utilisateurs</span>
          </div>
        </div>
        <div className="admin-stat-card admin-stat-gold">
          <span className="admin-stat-icon">🛡️</span>
          <div className="admin-stat-body">
            <span className="admin-stat-value">{totalAdmins}</span>
            <span className="admin-stat-label">Admins</span>
          </div>
        </div>
        <div className="admin-stat-card admin-stat-founder">
          <span className="admin-stat-icon">👑</span>
          <div className="admin-stat-body">
            <span className="admin-stat-value">{totalFounders}</span>
            <span className="admin-stat-label">Fondateur</span>
          </div>
        </div>
        <div className="admin-stat-card admin-stat-mint">
          <span className="admin-stat-icon">🟢</span>
          <div className="admin-stat-body">
            <span className="admin-stat-value">{onlineCount}</span>
            <span className="admin-stat-label">En ligne</span>
          </div>
        </div>
        <div className="admin-stat-card admin-stat-sky">
          <span className="admin-stat-icon">🆕</span>
          <div className="admin-stat-body">
            <span className="admin-stat-value">{recentUsers}</span>
            <span className="admin-stat-label">Nouveaux (7j)</span>
          </div>
        </div>
      </section>

      <section className="admin-toolbar">
        <div className="admin-search-wrapper">
          <svg className="admin-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            className="admin-search-input"
            type="text"
            placeholder="Rechercher un utilisateur..."
            value={adminSearch}
            onChange={(e) => onAdminSearchChange(e.target.value)}
          />
          {adminSearch && (
            <button className="admin-search-clear" onClick={() => onAdminSearchChange("")}>✕</button>
          )}
        </div>
        <div className="admin-filter-pills">
          {([["all", "Tous"], ["founder", "Fondateur"], ["admin", "Admins"], ["user", "Utilisateurs"]] as const).map(([val, label]) => (
            <button
              key={val}
              className={`admin-filter-pill ${adminRoleFilter === val ? "active" : ""}`}
              onClick={() => onAdminRoleFilterChange(val)}
            >
              {label}
              {val !== "all" && <span className="admin-filter-count">{adminUsers.filter((u) => u.role === val).length}</span>}
            </button>
          ))}
        </div>
      </section>

      {adminUsers.length === 0 && !adminLoading && !adminError && (
        <div className="admin-empty">
          <p>Cliquez sur Rafraichir pour charger les comptes.</p>
        </div>
      )}

      {filteredUsers.length === 0 && adminUsers.length > 0 && (
        <div className="admin-empty">
          <p>Aucun resultat pour cette recherche.</p>
        </div>
      )}

      {filteredUsers.length > 0 && (
        <section className="admin-users-grid">
          {filteredUsers.map((user) => {
            const isSelf = user.email === currentAccount.email;
            const isOnline = user.email === currentAccount.email || collaborators.some((c) => {
              const peerName = (c.name || "").toLowerCase();
              const userPseudo = (user.pseudo || "").toLowerCase();
              const userFirst = (user.firstName || "").toLowerCase();
              return peerName === userPseudo || peerName === userFirst || peerName === user.email.toLowerCase();
            });
            const roleBadgeClass = user.role === "founder" ? "admin-role-founder" : user.role === "admin" ? "admin-role-admin" : "admin-role-user";
            const roleLabel = user.role === "founder" ? "Fondateur" : user.role === "admin" ? "Admin" : "Utilisateur";
            const createdDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";

            return (
              <div key={user.id} className={`admin-user-card ${isSelf ? "admin-user-card-self" : ""}`}>
                <div className="admin-user-card-top">
                  <div className="admin-user-avatar" style={{ borderColor: user.cursorColor }}>
                    <span className="admin-user-avatar-letter" style={{ color: user.cursorColor }}>
                      {(user.pseudo || user.firstName || user.email).charAt(0).toUpperCase()}
                    </span>
                    {isOnline && <span className="admin-user-online-dot" />}
                  </div>
                  <div className="admin-user-identity">
                    <strong className="admin-user-pseudo">
                      {user.pseudo || "Sans pseudo"}
                      {isSelf && <span className="admin-user-you-chip">vous</span>}
                    </strong>
                    <span className="admin-user-fullname">{user.firstName} {user.lastName}</span>
                  </div>
                  <span className={`admin-role-badge ${roleBadgeClass}`}>{roleLabel}</span>
                </div>
                <div className="admin-user-card-details">
                  <div className="admin-user-detail-row">
                    <span className="admin-user-detail-icon">📧</span>
                    <span className="admin-user-detail-value">{user.email}</span>
                  </div>
                  <div className="admin-user-detail-row">
                    <span className="admin-user-detail-icon">📅</span>
                    <span className="admin-user-detail-value">Inscrit le {createdDate}</span>
                  </div>
                  <div className="admin-user-detail-row">
                    <span className="admin-user-detail-icon">🎨</span>
                    <span className="admin-user-detail-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      Couleur
                      <span className="admin-color-chip" style={{ background: user.cursorColor }} />
                    </span>
                  </div>
                  <div className="admin-user-detail-row">
                    <span className="admin-user-detail-icon">{isOnline ? "🟢" : "⚫"}</span>
                    <span className="admin-user-detail-value">{isOnline ? "En ligne" : "Hors ligne"}</span>
                  </div>
                </div>
                <div className="admin-user-card-actions" style={{ display: "flex", gap: 8 }}>
                  {isFounder && !isSelf && user.role !== "founder" && (
                    <button
                      type="button"
                      className={user.role === "admin" ? "outline-btn admin-demote-btn" : "primary-btn admin-promote-btn"}
                      onClick={() => onToggleRole(user.email, user.role === "admin" ? "user" : "admin")}
                      disabled={adminLoading}
                    >
                      {user.role === "admin" ? "Retirer admin" : "Promouvoir admin"}
                    </button>
                  )}
                  {user.role === "user" && (
                    <button
                      type="button"
                      className="outline-btn admin-perms-btn"
                      onClick={() => handleOpenPermissions(user)}
                      disabled={adminLoading}
                    >
                      Autorisation
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function renderVersionPage(
  updaterStatus: UpdaterStatus | null,
  availableUpdate: AvailableUpdate | null,
  checkingUpdates: boolean,
  installingUpdate: boolean,
  updaterMessage: string,
  updaterError: string,
  selectedPatchVersion: string,
  setSelectedPatchVersion: (v: string) => void,
  onCheckUpdates: () => void,
  onInstallUpdate: () => void
) {
  const selectedPatch = patchNotesData.find((p) => p.version === selectedPatchVersion) || patchNotesData[0];
  const currentVersion = updaterStatus?.currentVersion || "0.1.16";
  const currentPatch = patchNotesData.find((p) => p.version === currentVersion);

  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Version</span>
          <h1>Mises a jour et patch notes</h1>
          <p>Verifie les mises a jour disponibles et consulte l historique des versions.</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-btn" onClick={onCheckUpdates} disabled={checkingUpdates || installingUpdate}>
            {checkingUpdates ? "Verification..." : "Verifier"}
          </button>
        </div>
      </section>

      <section className="version-page-grid">
        <div className="version-left">
          <article className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Installation</span>
                <h2>Version actuelle</h2>
              </div>
            </div>
            <div className="panel-body stack">
              <div className="version-current-badge">
                <span className="version-number">v{currentVersion}</span>
                <span className={`version-config-pill ${updaterStatus?.configured ? "ok" : "warn"}`}>
                  {updaterStatus?.configured ? "Updater actif" : "Updater non configure"}
                </span>
              </div>

              {updaterStatus?.configured && (
                <div className="version-endpoint-note">
                  {updaterStatus.endpointCount} endpoint(s) configure(s)
                </div>
              )}

              {availableUpdate ? (
                <div className="status info">
                  Nouvelle version disponible : v{availableUpdate.version}
                  {availableUpdate.pubDate
                    ? (() => { const d = new Date(availableUpdate.pubDate!); return isNaN(d.getTime()) ? "" : ` — ${d.toLocaleDateString("fr-FR")}`; })()
                    : ""}
                </div>
              ) : null}

              {availableUpdate?.notes ? <div className="mini-note">{availableUpdate.notes}</div> : null}
              {updaterMessage ? <div className="status ok">{updaterMessage}</div> : null}
              {updaterError ? <div className="status warn">{updaterError}</div> : null}

              <div className="ticket-modal-actions">
                <button className="ghost-btn" onClick={onCheckUpdates} disabled={checkingUpdates || installingUpdate}>
                  {checkingUpdates ? "Verification..." : "Verifier les mises a jour"}
                </button>
                <button
                  className="primary-btn"
                  onClick={onInstallUpdate}
                  disabled={!availableUpdate || checkingUpdates || installingUpdate}
                >
                  {installingUpdate ? "Installation..." : "Installer la mise a jour"}
                </button>
              </div>
            </div>
          </article>

          {currentPatch ? (
            <article className="panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">Notes</span>
                  <h2>Quoi de neuf en v{currentVersion}</h2>
                </div>
              </div>
              <div className="panel-body">
                <ul className="version-notes-list">
                  {currentPatch.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            </article>
          ) : null}
        </div>

        <div className="version-right">
          <article className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Historique</span>
                <h2>Patch notes</h2>
              </div>
            </div>
            <div className="panel-body stack">
              <select
                className="version-select"
                value={selectedPatchVersion}
                onChange={(e) => setSelectedPatchVersion(e.target.value)}
              >
                {patchNotesData.map((p) => (
                  <option key={p.version} value={p.version}>
                    v{p.version} — {new Date(p.date).toLocaleDateString("fr-FR")}
                  </option>
                ))}
              </select>

              <div className="version-patch-detail">
                <div className="version-patch-header">
                  <span className="version-number">v{selectedPatch.version}</span>
                  <span className="version-patch-date">
                    {new Date(selectedPatch.date).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <ul className="version-notes-list">
                  {selectedPatch.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function cloneReimbursementForm(form: ReimbursementFormLine): ReimbursementFormLine {
  return {
    category: form.category,
    amount: form.amount,
  };
}

function findMatchingReimbursementEntry(
  entries: ReimbursementDetailsEntry[],
  target: ReimbursementDetailsEntry
) {
  return (
    entries.find(
      (entry) =>
        entry.row === target.row &&
        entry.category === target.category &&
        Math.abs(entry.amount - target.amount) < 0.001
    ) ||
    entries.find(
      (entry) =>
        entry.category === target.category &&
        Math.abs(entry.amount - target.amount) < 0.001
    ) ||
    null
  );
}

function buildHistorySnapshot(params: {
  page: PageKey;
  selectedMonth: string;
  ticketSearch: string;
  ticketCategoryFilter: string;
  ticketStatusFilter: TicketStatusFilter;
  ticketSortMode: TicketSortMode;
  reimbursementForm: ReimbursementFormLine;
  sharedNote: string;
}): HistorySnapshot {
  return {
    page: params.page,
    selectedMonth: params.selectedMonth,
    ticketSearch: params.ticketSearch,
    ticketCategoryFilter: params.ticketCategoryFilter,
    ticketStatusFilter: params.ticketStatusFilter,
    ticketSortMode: params.ticketSortMode,
    reimbursementForm: cloneReimbursementForm(params.reimbursementForm),
    sharedNote: params.sharedNote,
  };
}

function areSnapshotsEqual(a: HistorySnapshot, b: HistorySnapshot) {
  return (
    a.page === b.page &&
    a.selectedMonth === b.selectedMonth &&
    a.ticketSearch === b.ticketSearch &&
    a.ticketCategoryFilter === b.ticketCategoryFilter &&
    a.ticketStatusFilter === b.ticketStatusFilter &&
    a.ticketSortMode === b.ticketSortMode &&
    a.reimbursementForm.category === b.reimbursementForm.category &&
    a.reimbursementForm.amount === b.reimbursementForm.amount &&
    a.sharedNote === b.sharedNote
  );
}

function describeHistorySnapshotChange(from: HistorySnapshot, to: HistorySnapshot) {
  const changes: string[] = [];

  if (from.page !== to.page) {
    changes.push(`page ${pageMeta[to.page].title.toLowerCase()}`);
  }

  if (from.selectedMonth !== to.selectedMonth) {
    changes.push(`mois ${getSelectedMonthLabel(to.selectedMonth).toLowerCase()}`);
  }

  if (from.ticketSearch !== to.ticketSearch) {
    changes.push(to.ticketSearch ? `recherche "${to.ticketSearch}"` : "recherche effacee");
  }

  if (from.ticketCategoryFilter !== to.ticketCategoryFilter) {
    changes.push(
      to.ticketCategoryFilter === "all"
        ? "categorie tous"
        : `categorie ${to.ticketCategoryFilter.toLowerCase()}`
    );
  }

  if (from.ticketStatusFilter !== to.ticketStatusFilter) {
    const nextLabel =
      to.ticketStatusFilter === "all"
        ? "tous"
        : to.ticketStatusFilter === "sent"
          ? "envoyes"
          : "non envoyes";
    changes.push(`filtre ${nextLabel}`);
  }

  if (from.ticketSortMode !== to.ticketSortMode) {
    const nextLabel =
      to.ticketSortMode === "amount_desc"
        ? "tri montant decroissant"
        : to.ticketSortMode === "amount_asc"
          ? "tri montant croissant"
          : to.ticketSortMode === "date_asc"
            ? "tri date croissante"
            : "tri date decroissante";
    changes.push(nextLabel);
  }

  if (from.reimbursementForm.category !== to.reimbursementForm.category) {
    changes.push(`type remboursement ${to.reimbursementForm.category.toLowerCase()}`);
  }

  if (from.reimbursementForm.amount !== to.reimbursementForm.amount) {
    changes.push(
      to.reimbursementForm.amount
        ? `montant remboursement ${to.reimbursementForm.amount}`
        : "montant remboursement efface"
    );
  }

  if (from.sharedNote !== to.sharedNote) {
    changes.push(to.sharedNote.trim() ? "note collab restauree" : "note collab vide");
  }

  if (changes.length === 0) {
    return "dernier etat local restaure";
  }

  if (changes.length === 1) {
    return changes[0];
  }

  return `${changes[0]} et ${changes.length - 1} autre(s) changement(s)`;
}

function getLocalHistoryTitle(detail: string) {
  const lowerDetail = detail.toLowerCase();

  if (lowerDetail.includes("recherche")) {
    return "Recherche modifiee";
  }

  if (lowerDetail.includes("categorie") || lowerDetail.includes("filtre")) {
    return "Filtres modifies";
  }

  if (lowerDetail.includes("tri")) {
    return "Tri modifie";
  }

  if (lowerDetail.includes("mois")) {
    return "Mois change";
  }

  if (lowerDetail.includes("page")) {
    return "Navigation modifiee";
  }

  if (lowerDetail.includes("note collab")) {
    return "Note collab modifiee";
  }

  if (lowerDetail.includes("remboursement")) {
    return "Saisie remboursement modifiee";
  }

  return "Modification locale";
}

function shouldHandleGlobalHistoryShortcut(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return true;
  }

  if (element.closest('[data-history-global="true"]')) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  const isEditableField =
    element.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select";

  return !isEditableField;
}

function App() {
  const [page, setPage] = useState<PageKey>(getInitialPage);
  const [currentAccount, setCurrentAccount] = useState<AccountProfile | null>(loadStoredSessionAccount);



  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [signInForm, setSignInForm] = useState<SignInForm>({
    email: loadStoredSessionAccount()?.email || "",
    password: "",
  });
  const [signUpForm, setSignUpForm] = useState<SignUpForm>({
    firstName: "",
    lastName: "",
    pseudo: "",
    email: "",
    password: "",
    confirmPassword: "",
    cursorColor: collabColors[0],
  });
  const [accountSettingsForm, setAccountSettingsForm] = useState<AccountSettingsForm>({
    firstName: "",
    lastName: "",
    pseudo: "",
    email: "",
    cursorColor: collabColors[0],
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [historyState, setHistoryState] = useState<HistoryState>({
    past: [],
    future: [],
  });
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyToasts, setHistoryToasts] = useState<HistoryEvent[]>([]);
  const [pendingHistoryAction, setPendingHistoryAction] = useState<"undo" | "redo" | null>(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [accountSettingsLoading, setAccountSettingsLoading] = useState(false);
  const [accountSettingsStatus, setAccountSettingsStatus] = useState("");
  const [accountSettingsError, setAccountSettingsError] = useState("");
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updaterMessage, setUpdaterMessage] = useState("");
  const [updaterError, setUpdaterError] = useState("");
  const [selectedPatchVersion, setSelectedPatchVersion] = useState("0.1.19");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [dashboardSubscriptions, setDashboardSubscriptions] = useState<DashboardSubscription[]>(() => {
    try {
      const raw = window.localStorage.getItem(dashboardSubscriptionsStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [subPanelOpen, setSubPanelOpen] = useState(false);
  const [subDeletePanelOpen, setSubDeletePanelOpen] = useState(false);
  const [dashboardUnexpectedModalOpen, setDashboardUnexpectedModalOpen] = useState(false);
  const [subFormLabel, setSubFormLabel] = useState("");
  const [subFormAmount, setSubFormAmount] = useState("");
  const [subFormError, setSubFormError] = useState("");
  const [ticketMonthSummary, setTicketMonthSummary] = useState<TicketMonthSummary | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [refreshingTickets, setRefreshingTickets] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [lastTicketsSyncAt, setLastTicketsSyncAt] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue);
  const [auditReferenceMonth, setAuditReferenceMonth] = useState(() =>
    getRelativeMonthValue(getCurrentMonthValue(), -1)
  );
  const [auditReloadSeed, setAuditReloadSeed] = useState(0);
  const [comparePrimaryMonth, setComparePrimaryMonth] = useState(selectedMonth);
  const [compareSecondaryMonth, setCompareSecondaryMonth] = useState(() =>
    getRelativeMonthValue(selectedMonth, -1)
  );
  const [compareSortMode, setCompareSortMode] = useState<CompareSortMode>("delta");
  const [compareReloadSeed, setCompareReloadSeed] = useState(0);
  const [compareMonthStates, setCompareMonthStates] = useState<
    Record<string, CompareMonthState>
  >({});
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState("all");
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatusFilter>("all");
  const [ticketSortMode, setTicketSortMode] = useState<TicketSortMode>("date_desc");
  const [reloadSeed, setReloadSeed] = useState(0);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [ticketsSheetModalOpen, setTicketsSheetModalOpen] = useState(false);
  const [budgetDetailsOpen, setBudgetDetailsOpen] = useState(false);
  const [budgetPreviewTicket, setBudgetPreviewTicket] = useState<Ticket | null>(null);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [submitTicketError, setSubmitTicketError] = useState("");
  const [ticketCategoryPromptOpen, setTicketCategoryPromptOpen] = useState(false);
  const [ticketFollowUpPrompt, setTicketFollowUpPrompt] = useState<TicketFollowUpPrompt | null>(null);
  const [csvImportModalOpen, setCsvImportModalOpen] = useState(false);
  const [csvImportDrafts, setCsvImportDrafts] = useState<CsvImportDraft[]>([]);
  const [csvImportSummary, setCsvImportSummary] = useState<CsvImportSummary>(
    createEmptyCsvImportSummary
  );
  const [csvImportTargetMonth, setCsvImportTargetMonth] = useState(selectedMonth);
  const [csvImportFileName, setCsvImportFileName] = useState("");
  const [sharedCsvImportSession, setSharedCsvImportSession] = useState<SharedCsvImportSession | null>(null);
  const [csvImportLoading, setCsvImportLoading] = useState(false);
  const [csvImportSubmitting, setCsvImportSubmitting] = useState(false);
  const [csvImportError, setCsvImportError] = useState("");
  const [csvImportStatus, setCsvImportStatus] = useState("");
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [editTicketForm, setEditTicketForm] = useState({ date: "", description: "", category: "", amount: "" });
  const [editTicketSaving, setEditTicketSaving] = useState(false);
  const [editTicketError, setEditTicketError] = useState("");
  const [reimbursementForm, setReimbursementForm] = useState<ReimbursementFormLine>(
    createEmptyReimbursementLine
  );
  const [reimbursementDetails, setReimbursementDetails] = useState<ReimbursementDetails>({
    entries: [],
    ceTotal: 0,
    medecinTotal: 0,
    total: 0,
  });
  const [submittingReimbursements, setSubmittingReimbursements] = useState(false);
  const [deletingReimbursementRow, setDeletingReimbursementRow] = useState<number | null>(null);
  const [undoingReimbursement, setUndoingReimbursement] = useState(false);
  const [reimbursementStatus, setReimbursementStatus] = useState("");
  const [reimbursementError, setReimbursementError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceStep, setVoiceStep] = useState<VoiceStep>("date");
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [collabIdentity, setCollabIdentity] = useState<CollabIdentity>(createCollabIdentity);
  const [localCollaborators, setLocalCollaborators] = useState<Collaborator[]>([]);
  const [remoteCollaborators, setRemoteCollaborators] = useState<Collaborator[]>([]);
  const [collabFeed, setCollabFeed] = useState<CollabFeedItem[]>([]);
  const [collabSignals, setCollabSignals] = useState<CollabSignal[]>([]);
  const [followedPeerId, setFollowedPeerId] = useState("");
  const [showOnlinePopup, setShowOnlinePopup] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AccountProfile[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminRoleFilter, setAdminRoleFilter] = useState<"all" | "founder" | "admin" | "user">("all");
  const [permissionsModalUser, setPermissionsModalUser] = useState<AccountProfile | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<AccountPagePermissions | null>(null);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [permissionsError, setPermissionsError] = useState("");
  const [deniedPageModal, setDeniedPageModal] = useState<PageKey | null>(null);
  const [collabConnectionState, setCollabConnectionState] = useState<
    "connecting" | "live" | "unstable"
  >("connecting");
  const [sharedNote, setSharedNote] = useState(
    () =>
      (typeof window !== "undefined" &&
        window.localStorage.getItem(collabSharedNoteStorageKey)) ||
      "Idees partagees: curseurs live, presence et edition des tickets."
  );
  const [collabStatus, setCollabStatus] = useState("");
  const [collabError, setCollabError] = useState("");
  const [newTicketForm, setNewTicketForm] = useState<NewTicketForm>({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    description: "",
    category: "",
  });
  const csvImportSharedSubmitting = Boolean(sharedCsvImportSession?.submittingById);
  const csvImportUiBusy = csvImportLoading || csvImportSubmitting || csvImportSharedSubmitting;
  const newTicketFormRef = useRef(newTicketForm);
  const ticketFollowUpPromptRef = useRef<TicketFollowUpPrompt | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRestartRecognitionRef = useRef(false);
  const voiceStepRef = useRef<VoiceStep>("date");
  const collabChannelRef = useRef<BroadcastChannel | null>(null);
  const collabIdentityRef = useRef<CollabIdentity>(createCollabIdentity());
  const pageRef = useRef<PageKey>(getInitialPage());
  const selectedMonthRef = useRef(selectedMonth);
  const ticketsRef = useRef<Ticket[]>([]);
  const csvImportInputRef = useRef<HTMLInputElement | null>(null);
  const sharedCsvImportSessionRef = useRef<SharedCsvImportSession | null>(null);
  const lastCsvImportSessionEventAtRef = useRef(0);
  const lastLoadedMonthRef = useRef("");
  const monthDataCacheRef = useRef<Record<string, MonthDataCacheEntry>>({});
  const lastTicketReloadSeedRef = useRef<number | null>(null);
  const onReloadDoneRef = useRef<(() => void) | null>(null);
  const lastCompareReloadSeedRef = useRef<number | null>(null);
  const lastAuditReloadSeedRef = useRef<number | null>(null);
  const lastPassiveRefreshAtRef = useRef(0);
  const historyEventsStorageKeyRef = useRef("");
  const collabNoteTimestampRef = useRef(0);
  const sharedNoteRef = useRef(sharedNote);
  const collabPointerStateRef = useRef<PointerState>({
    x: 50,
    y: 50,
    visible: false,
    scrollY: 0,
  });
  const collabFocusRef = useRef({ key: "", label: "" });
  const lastPointerSentAtRef = useRef(0);
  const mainScrollYRef = useRef(0);
  const [mainScrollY, setMainScrollY] = useState(0);
  const mainElRef = useRef<HTMLElement | null>(null);
  const supabaseChannelRef = useRef<RealtimeChannel | null>(null);
  const pushSupabasePresenceRef = useRef<((event?: "heartbeat" | "pointer" | "focus") => void) | null>(null);
  const knownPeerIdsRef = useRef<Set<string>>(new Set());
  const startupUpdaterCheckedRef = useRef(false);
  const historySnapshotRef = useRef<HistorySnapshot | null>(null);
  const reimbursementUndoActionRef = useRef<ReimbursementRemoteHistoryAction | null>(null);
  const reimbursementRedoActionRef = useRef<ReimbursementRemoteHistoryAction | null>(null);
  const deferredTicketSearch = useDeferredValue(ticketSearch);
  const isTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const collaborators = mergeCollaboratorLists(localCollaborators, remoteCollaborators);
  const visibleRemoteCursors =
    page === "collab"
      ? []
      : collaborators.filter((peer) => peer.insideBoard && peer.page === page);
  const visibleTickets = filterAndSortTickets(
    tickets,
    deferredTicketSearch,
    ticketCategoryFilter,
    ticketStatusFilter,
    ticketSortMode
  );
  const comparePrimaryState =
    compareMonthStates[comparePrimaryMonth] ?? createEmptyCompareMonthState();
  const compareSecondaryState =
    compareMonthStates[compareSecondaryMonth] ?? createEmptyCompareMonthState();
  const auditReferenceState =
    compareMonthStates[auditReferenceMonth] ?? createEmptyCompareMonthState();
  const updateNewTicketForm = (
    update: NewTicketForm | ((current: NewTicketForm) => NewTicketForm)
  ) => {
    setNewTicketForm((current) => {
      const next =
        typeof update === "function"
          ? (update as (current: NewTicketForm) => NewTicketForm)(current)
          : update;
      newTicketFormRef.current = next;
      return next;
    });
  };
  const updateAvailable = Boolean(availableUpdate);
  const updateBannerDateLabel =
    updateAvailable && availableUpdate?.pubDate
      ? (() => { const d = new Date(availableUpdate.pubDate!); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR"); })()
      : "";

  useEffect(() => {
    const Recognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    setVoiceSupported(Boolean(Recognition));
  }, []);

  useEffect(() => {
    voiceStepRef.current = voiceStep;
  }, [voiceStep]);

  useEffect(() => {
    newTicketFormRef.current = newTicketForm;
  }, [newTicketForm]);

  useEffect(() => {
    ticketFollowUpPromptRef.current = ticketFollowUpPrompt;
  }, [ticketFollowUpPrompt]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    sharedCsvImportSessionRef.current = sharedCsvImportSession;
  }, [sharedCsvImportSession]);

  useEffect(() => {
    collabIdentityRef.current = collabIdentity;
  }, [collabIdentity]);

  useEffect(() => {
    sharedNoteRef.current = sharedNote;
  }, [sharedNote]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCollabSignals((current) => pruneCollabSignals(current));
    }, 900);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!currentAccount) {
      return;
    }

    setAccountSettingsForm({
      firstName: currentAccount.firstName,
      lastName: currentAccount.lastName,
      pseudo: currentAccount.pseudo,
      email: currentAccount.email,
      cursorColor: currentAccount.cursorColor,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setAccountSettingsStatus("");
    setAccountSettingsError("");
  }, [currentAccount]);

  useEffect(() => {
    if (!currentAccount) {
      return;
    }

    setCollabIdentity((current) => {
      const next = {
        ...current,
        name: getAccountDisplayName(currentAccount),
        color: currentAccount.cursorColor,
      };
      persistCollabIdentity(next);
      return next;
    });
  }, [currentAccount]);

  useEffect(() => {
    pageRef.current = page;

    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("page", page);
    window.history.replaceState({}, "", url);
  }, [page]);

  useEffect(() => {
    selectedMonthRef.current = selectedMonth;
  }, [selectedMonth]);

  useEffect(() => {
    setDashboardUnexpectedModalOpen(false);
  }, [selectedMonth, page]);

  useEffect(() => {
    setTicketsSheetModalOpen(false);
  }, [selectedMonth, page]);

  useEffect(() => {
    if (auditReferenceMonth === selectedMonth) {
      setAuditReferenceMonth(getRelativeMonthValue(selectedMonth, -1));
    }
  }, [selectedMonth, auditReferenceMonth]);

  useEffect(() => {
    if (currentAccount) {
      return;
    }

    monthDataCacheRef.current = {};
    lastTicketReloadSeedRef.current = null;
    lastCompareReloadSeedRef.current = null;
    lastAuditReloadSeedRef.current = null;
    lastPassiveRefreshAtRef.current = 0;
    sharedCsvImportSessionRef.current = null;
    setSharedCsvImportSession(null);
  }, [currentAccount]);

  useEffect(() => {
    if (!currentAccount) {
      historyEventsStorageKeyRef.current = "";
      setHistoryEvents([]);
      setHistoryToasts([]);
      return;
    }

    const storageKey = getHistoryEventsStorageKey(currentAccount.email);
    historyEventsStorageKeyRef.current = storageKey;
    setHistoryEvents(loadStoredHistoryEvents(currentAccount.email));
    setHistoryToasts([]);
  }, [currentAccount?.email]);

  useEffect(() => {
    if (typeof window === "undefined" || !historyEventsStorageKeyRef.current) {
      return;
    }

    window.localStorage.setItem(
      historyEventsStorageKeyRef.current,
      JSON.stringify(historyEvents)
    );
  }, [historyEvents]);

  useEffect(() => {
    setBudgetPreviewTicket(null);
    setBudgetDetailsOpen(false);
  }, [selectedMonth]);

  const captureCurrentSnapshot = (): HistorySnapshot =>
    buildHistorySnapshot({
      page,
      selectedMonth,
      ticketSearch,
      ticketCategoryFilter,
      ticketStatusFilter,
      ticketSortMode,
      reimbursementForm,
      sharedNote,
    });

  const applyHistorySnapshot = (snapshot: HistorySnapshot) => {
    setPage(snapshot.page);
    setSelectedMonth(snapshot.selectedMonth);
    setTicketSearch(snapshot.ticketSearch);
    setTicketCategoryFilter(snapshot.ticketCategoryFilter);
    setTicketStatusFilter(snapshot.ticketStatusFilter);
    setTicketSortMode(snapshot.ticketSortMode);
    setReimbursementForm(cloneReimbursementForm(snapshot.reimbursementForm));
    setSharedNote(snapshot.sharedNote);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(collabSharedNoteStorageKey, snapshot.sharedNote);
    }

    setReimbursementStatus("");
    setReimbursementError("");
  };

  const pushHistorySnapshot = () => {
    const snapshot = captureCurrentSnapshot();
    const lastSnapshot = historySnapshotRef.current;

    if (lastSnapshot && areSnapshotsEqual(lastSnapshot, snapshot)) {
      return;
    }

    setHistoryState((current) => ({
      past: [...current.past, snapshot],
      future: [],
    }));

    historySnapshotRef.current = snapshot;
  };

  const pushHistoryEvent = (
    event: Omit<HistoryEvent, "id" | "createdAt">,
    options?: { broadcast?: boolean; createdAt?: number; silent?: boolean }
  ) => {
    const shouldBroadcast = options?.broadcast !== false;
    const now = options?.createdAt ?? Date.now();

    const fullEvent: HistoryEvent = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      ...event,
      createdAt: now,
    };

    setHistoryEvents((current) => prependHistoryEvent(current, fullEvent));
    if (!options?.silent) {
      setHistoryToasts((current) => prependHistoryEvent(current, fullEvent).slice(0, 5));
    }

    if (shouldBroadcast) {
      const historyMessage = {
        type: "history" as const,
        user: collabIdentityRef.current,
        event,
        timestamp: now,
      } satisfies CollabMessage;

      collabChannelRef.current?.postMessage(historyMessage);

      void supabaseChannelRef.current?.send({
        type: "broadcast",
        event: "history",
        payload: {
          id: collabIdentityRef.current.id,
          name: collabIdentityRef.current.name,
          color: collabIdentityRef.current.color,
          seed: collabIdentityRef.current.seed,
          historyEvent: event,
          timestamp: now,
        },
      });
    }

    if (!options?.createdAt) {
      supabase.from("collab_history_events").insert({
        id: fullEvent.id,
        user_id: collabIdentityRef.current.id,
        user_name: collabIdentityRef.current.name,
        event_tone: event.tone,
        event_source: event.source,
        event_title: event.title,
        event_detail: event.detail,
        event_shortcut: event.shortcut ?? null,
        timestamp: now,
      }).then(({ error }) => {
        console.log("insert result:", error ?? "OK");
      });
    }
  };

  const handleDeleteHistoryEvent = (eventId: string) => {
    setHistoryEvents((current) => current.filter((item) => item.id !== eventId));
    setHistoryToasts((current) => current.filter((item) => item.id !== eventId));
  };

  const handleClearHistoryEvents = () => {
    setHistoryEvents([]);
    setHistoryToasts([]);
  };

  const handleUndo = async () => {
    const remoteAction = reimbursementUndoActionRef.current;

    if (remoteAction?.kind === "delete") {
      try {
        setUndoingReimbursement(true);
        setReimbursementStatus("");
        setReimbursementError("");

        const response = await createReimbursementsInSheets(remoteAction.month, [
          {
            category: remoteAction.entry.category,
            amount: String(remoteAction.entry.amount),
            targetRow: remoteAction.entry.row,
          },
        ]);

        const responseObject = response as {
          success?: boolean;
          error?: string;
        };

        if (responseObject?.success === false) {
          throw new Error(
            responseObject.error || "Restauration du remboursement refusee par Google Sheets."
          );
        }

        reimbursementUndoActionRef.current = null;
        reimbursementRedoActionRef.current = remoteAction;

        setReimbursementStatus(
          `Remboursement restaure dans ${getSelectedMonthLabel(remoteAction.month)}.`
        );
        pushHistoryEvent({
          tone: "ok",
          source: "sheet",
          shortcut: "Ctrl+Z",
          title: "Remboursement restaure",
          detail: `${remoteAction.entry.category} • ${euro.format(remoteAction.entry.amount)} • H${remoteAction.entry.row} / I${remoteAction.entry.row} • ${getSelectedMonthLabel(remoteAction.month)}`,
        });
        onReloadDoneRef.current = () => { setUndoingReimbursement(false); setPendingHistoryAction(null); };
        setReloadSeed((value) => value + 1);
        return;
      } catch (error) {
        const message = getErrorMessage(error);
        setReimbursementError(message);
        pushHistoryEvent({
          tone: "warn",
          source: "sheet",
          shortcut: "Ctrl+Z",
          title: "Retour arriere refuse",
          detail: message,
        });
        setUndoingReimbursement(false);
        setPendingHistoryAction(null);
      }
    }

    if (historyState.past.length === 0) {
      setPendingHistoryAction(null);
      return;
    }

    const previous = historyState.past[historyState.past.length - 1];
    const currentSnapshot = captureCurrentSnapshot();
    const summary = describeHistorySnapshotChange(currentSnapshot, previous);

    applyHistorySnapshot(previous);
    historySnapshotRef.current = previous;
    setHistoryState({
      past: historyState.past.slice(0, -1),
      future: [currentSnapshot, ...historyState.future],
    });
    pushHistoryEvent({
      tone: "info",
      source: "app",
      shortcut: "Ctrl+Z",
      title: getLocalHistoryTitle(summary),
      detail: summary,
    });
    setPendingHistoryAction(null);
  };

  const handleRedo = async () => {
    const remoteAction = reimbursementRedoActionRef.current;

    if (remoteAction?.kind === "delete") {
      const entryToDelete = findMatchingReimbursementEntry(
        reimbursementDetails.entries,
        remoteAction.entry
      );

      if (!entryToDelete) {
        setReimbursementError(
          "Impossible de refaire la suppression : remboursement introuvable apres restauration."
        );
        setPendingHistoryAction(null);
        return;
      }

      try {
        setReimbursementStatus("");
        setReimbursementError("");

        const response = await deleteReimbursementInSheets(remoteAction.month, entryToDelete.row);
        const responseObject = response as {
          success?: boolean;
          error?: string;
        };

        if (responseObject?.success === false) {
          throw new Error(
            responseObject.error || "Nouvelle suppression du remboursement refusee par Google Sheets."
          );
        }

        reimbursementRedoActionRef.current = null;
        reimbursementUndoActionRef.current = {
          kind: "delete",
          month: remoteAction.month,
          entry: entryToDelete,
        };

        setReimbursementStatus(`Remboursement supprime de nouveau.`);
        pushHistoryEvent({
          tone: "ok",
          source: "sheet",
          shortcut: "Ctrl+Y",
          title: "Remboursement supprime",
          detail: `${entryToDelete.category} • ${euro.format(entryToDelete.amount)} • H${entryToDelete.row} / I${entryToDelete.row} • ${getSelectedMonthLabel(remoteAction.month)}`,
        });
        onReloadDoneRef.current = () => setPendingHistoryAction(null);
        setReloadSeed((value) => value + 1);
        return;
      } catch (error) {
        const message = getErrorMessage(error);
        setReimbursementError(message);
        pushHistoryEvent({
          tone: "warn",
          source: "sheet",
          shortcut: "Ctrl+Y",
          title: "Retour avant refuse",
          detail: message,
        });
        setPendingHistoryAction(null);
        return;
      }
    }

    if (historyState.future.length === 0) {
      setPendingHistoryAction(null);
      return;
    }

    const next = historyState.future[0];
    const currentSnapshot = captureCurrentSnapshot();
    const summary = describeHistorySnapshotChange(currentSnapshot, next);

    applyHistorySnapshot(next);
    historySnapshotRef.current = next;
    setHistoryState({
      past: [...historyState.past, currentSnapshot],
      future: historyState.future.slice(1),
    });
    pushHistoryEvent({
      tone: "info",
      source: "app",
      shortcut: "Ctrl+Y",
      title: getLocalHistoryTitle(summary),
      detail: summary,
    });
    setPendingHistoryAction(null);
  };

  const canUndo =
    historyState.past.length > 0 || reimbursementUndoActionRef.current !== null;
  const canRedo =
    historyState.future.length > 0 || reimbursementRedoActionRef.current !== null;

  const pageLabels: Record<keyof AccountPagePermissions, string> = {
    dashboard: "Dashboard",
    tickets: "Tickets",
    annual: "Annuel",
    audits: "Audits",
    compare: "Comparateur",
    subscriptions: "Abonnements",
    collab: "Collab",
    settings: "Paramètres",
    version: "Version",
    admin: "Admin panel",
  };

  const handleOpenPermissions = (user: AccountProfile) => {
    setPermissionsModalUser(user);
    setPermissionsDraft({ ...getEditablePermissions(user), admin: false });
    setPermissionsError("");
  };

  const handleClosePermissions = () => {
    if (permissionsSaving) return;
    setPermissionsModalUser(null);
    setPermissionsDraft(null);
    setPermissionsError("");
  };

  const handleTogglePermission = (key: keyof AccountPagePermissions) => {
    if (!permissionsDraft) return;
    if (key === "admin") return;
    setPermissionsDraft({ ...permissionsDraft, [key]: !permissionsDraft[key] });
  };

  const applyPermissionsUpdate = (
    targetEmail: string,
    pagePermissions: AccountPagePermissions
  ) => {
    const normalizedTargetEmail = normalizeEmail(targetEmail);
    const normalizedPermissions = normalizePagePermissions(
      pagePermissions,
      defaultUserPagePermissions
    );

    setAdminUsers((current) =>
      current.map((user) =>
        user.email === normalizedTargetEmail
          ? mergeAccountPermissions(user, normalizedPermissions)
          : user
      )
    );

    setPermissionsModalUser((current) =>
      current?.email === normalizedTargetEmail
        ? mergeAccountPermissions(current, normalizedPermissions)
        : current
    );

    setCurrentAccount((current) => {
      if (!current || current.email !== normalizedTargetEmail) {
        return current;
      }

      const updated = mergeAccountPermissions(current, normalizedPermissions);
      persistSessionAccount(updated);
      return updated;
    });
  };

  const handleSavePermissions = async () => {
    if (!currentAccount || !permissionsModalUser || !permissionsDraft) return;
    if (!isPrivileged(currentAccount)) return;

    const nextPermissions = { ...permissionsDraft, admin: false };

    try {
      setPermissionsSaving(true);
      setPermissionsError("");

      const updatedAccount = await updateUserPermissionsInSheets(
        currentAccount.email,
        currentAccount.sessionToken,
        permissionsModalUser.email,
        nextPermissions
      );

      applyPermissionsUpdate(updatedAccount.email, updatedAccount.pagePermissions);

      void supabaseChannelRef.current?.send({
        type: "broadcast",
        event: "permissions-update",
        payload: {
          targetEmail: updatedAccount.email,
          pagePermissions: updatedAccount.pagePermissions,
        },
      });

      collabChannelRef.current?.postMessage({
        type: "permissions",
        targetEmail: updatedAccount.email,
        pagePermissions: updatedAccount.pagePermissions,
        timestamp: Date.now(),
      } satisfies CollabMessage);

      pushHistoryEvent({
        tone: "ok",
        source: "app",
        title: "Autorisations mises a jour",
        detail: `${updatedAccount.email}: acces modules sauvegardes`,
        shortcut: null,
      }, { broadcast: false });

      setPermissionsModalUser(null);
      setPermissionsDraft(null);
      setPermissionsError("");
    } catch (error) {
      setPermissionsError(getErrorMessage(error));
    } finally {
      setPermissionsSaving(false);
    }
  };

  const permissionsModal =
    permissionsModalUser && permissionsDraft && typeof document !== "undefined"
      ? createPortal(
          <div className="admin-perms-modal-backdrop" onClick={handleClosePermissions}>
            <div className="admin-perms-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Autorisation d'accès</h2>
              <div className="admin-perms-user-summary">
                <span
                  className="admin-user-avatar-letter"
                  style={{ color: permissionsModalUser.cursorColor }}
                >
                  {(permissionsModalUser.pseudo || permissionsModalUser.firstName || permissionsModalUser.email)
                    .charAt(0)
                    .toUpperCase()}
                </span>
                <div>
                  <strong>{permissionsModalUser.pseudo || permissionsModalUser.email}</strong>
                  <div style={{ fontSize: 13, color: "#888" }}>{permissionsModalUser.email}</div>
                </div>
              </div>
              <div style={{ marginTop: 24 }}>
                <div className="admin-perms-list">
                  {accountPagePermissionKeys.map((key) => {
                    const isAdminPermission = key === "admin";

                    return (
                      <button
                        key={key}
                        type="button"
                        className={`admin-perms-row ${permissionsDraft[key] ? "enabled" : "disabled"} ${isAdminPermission ? "locked" : ""}`}
                        onClick={() => handleTogglePermission(key)}
                        disabled={permissionsSaving || isAdminPermission}
                        title={isAdminPermission ? "L admin se donne avec le role admin, pas avec les permissions utilisateur." : undefined}
                      >
                        <span>
                          {pageLabels[key]}
                          {isAdminPermission ? <small>Role admin requis</small> : null}
                        </span>
                        <strong>{isAdminPermission ? "Role" : permissionsDraft[key] ? "Oui" : "Non"}</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
              {permissionsError ? <div className="admin-error admin-perms-error">{permissionsError}</div> : null}
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="ghost-btn" onClick={handleClosePermissions}>
                  Fermer
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleSavePermissions}
                  disabled={permissionsSaving}
                >
                  {permissionsSaving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

   useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const isUndo = ctrlOrMeta && !event.shiftKey && key === "z";
      const isRedo =
        (ctrlOrMeta && key === "y") ||
        (ctrlOrMeta && event.shiftKey && key === "z");

      if (!isUndo && !isRedo) {
        return;
      }

      if (!shouldHandleGlobalHistoryShortcut(event.target)) {
        return;
      }

      if (isUndo && !canUndo) {
        return;
      }

      if (isRedo && !canRedo) {
        return;
      }

      event.preventDefault();

      if (isUndo) {
        setPendingHistoryAction("undo");
        handleUndo();
        return;
      }

      setPendingHistoryAction("redo");
      handleRedo();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canUndo, canRedo, handleUndo, handleRedo]);

  useEffect(() => {
    historySnapshotRef.current = captureCurrentSnapshot();
  }, [
    page,
    selectedMonth,
    ticketSearch,
    ticketCategoryFilter,
    ticketStatusFilter,
    ticketSortMode,
    reimbursementForm,
    sharedNote,
  ]);

  const pushCollabFeed = (
    id: string,
    text: string,
    tone: "info" | "ok" | "warn",
    color: string,
    createdAt = Date.now()
  ) => {
    setCollabFeed((current) =>
      appendCollabFeedItem(current, buildCollabFeedItem(id, text, tone, color, createdAt))
    );
  };

  const registerPeerSeen = (peer: Collaborator) => {
    if (!knownPeerIdsRef.current.has(peer.id)) {
      knownPeerIdsRef.current.add(peer.id);
      pushCollabFeed(
        `join:${peer.id}`,
        `${peer.name} vient de rejoindre la collab.`,
        "ok",
        peer.color,
        peer.lastSeen
      );
    }
  };

  const unregisterPeer = (peerId: string, fallbackName?: string, fallbackColor?: string) => {
    if (!knownPeerIdsRef.current.has(peerId)) {
      return;
    }

    knownPeerIdsRef.current.delete(peerId);
    pushCollabFeed(
      `leave:${peerId}:${Date.now()}`,
      `${fallbackName || "Une session"} a quitte la collab.`,
      "warn",
      fallbackColor || collabColors[0]
    );
  };

  const pushSignal = (
    signalId: string,
    kind: CollabSignalKind,
    author: string,
    color: string,
    x: number,
    y: number,
    createdAt: number
  ) => {
    const signal = createCollabSignalBubble(signalId, kind, author, color, x, y, createdAt);
    setCollabSignals((current) => appendCollabSignal(current, signal));
    pushCollabFeed(
      `signal:${signalId}`,
      `${author} • ${signal.label}`,
      collabSignalPresets[kind].tone,
      color,
      createdAt
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(collabChannelName);
    collabChannelRef.current = channel;

    const broadcastPresence = () => {
      channel.postMessage({
        type: "presence",
        user: collabIdentity,
        page: pageRef.current,
        context: getPresenceContext(pageRef.current, selectedMonthRef.current),
        timestamp: Date.now(),
      } satisfies CollabMessage);
    };

    channel.onmessage = (event) => {
      const message = event.data as CollabMessage;
      if (!message) {
        return;
      }

      if ("user" in message && message.user.id === collabIdentity.id) {
        return;
      }

      if (message.type === "leave") {
        unregisterPeer(message.userId, "Une session");
        setLocalCollaborators((current) => current.filter((item) => item.id !== message.userId));
        return;
      }

      if (message.type === "note") {
        if (message.timestamp < collabNoteTimestampRef.current) {
          return;
        }

        collabNoteTimestampRef.current = message.timestamp;
        setSharedNote(message.note);
        window.localStorage.setItem(collabSharedNoteStorageKey, message.note);
        setCollabStatus(`${message.user.name} a mis a jour le bloc note partage.`);
        pushCollabFeed(
          `note:${message.user.id}:${message.timestamp}`,
          `${message.user.name} a modifie le bloc-note partage.`,
          "info",
          message.user.color,
          message.timestamp
        );
        registerPeerSeen({
          ...message.user,
          page: "collab",
          context: "Bloc-note partage",
          cursorX: 50,
          cursorY: 50,
          scrollY: 0,
          insideBoard: false,
          lastSeen: message.timestamp,
          focusTicketKey: "",
          focusTicketLabel: "",
        });
        return;
      }

      if (message.type === "signal") {
        pushSignal(
          message.signalId,
          message.kind,
          message.user.name,
          message.user.color,
          message.x,
          message.y,
          message.timestamp
        );
        return;
      }

      if (message.type === "history") {
        pushHistoryEvent(
          { ...message.event, author: message.user.name },
          { broadcast: false, createdAt: message.timestamp }
        );
        return;
      }

      if (message.type === "subscriptions") {
        setDashboardSubscriptions(message.subscriptions);
        window.localStorage.setItem(
          dashboardSubscriptionsStorageKey,
          JSON.stringify(message.subscriptions)
        );
        return;
      }

      if (message.type === "permissions") {
        applyPermissionsUpdate(message.targetEmail, message.pagePermissions);
        return;
      }

      if (message.type === "importSession") {
        applyIncomingSharedCsvImportSession(message.session, message.timestamp);
        return;
      }

      if (message.type === "presence") {
        setLocalCollaborators((current) =>
          {
            const peer = {
              ...message.user,
              page: message.page,
              context: message.context,
              cursorX: current.find((item) => item.id === message.user.id)?.cursorX ?? 50,
              cursorY: current.find((item) => item.id === message.user.id)?.cursorY ?? 50,
              scrollY: current.find((item) => item.id === message.user.id)?.scrollY ?? 0,
              insideBoard: current.find((item) => item.id === message.user.id)?.insideBoard ?? false,
              lastSeen: message.timestamp,
              focusTicketKey: current.find((item) => item.id === message.user.id)?.focusTicketKey ?? "",
              focusTicketLabel: current.find((item) => item.id === message.user.id)?.focusTicketLabel ?? "",
            };
            registerPeerSeen(peer);
            return upsertCollaboratorEntry(current, peer);
          }
        );
        return;
      }

      if (message.type === "pointer") {
        setLocalCollaborators((current) =>
          {
            const peer = {
              ...message.user,
              page: message.page,
              context: current.find((item) => item.id === message.user.id)?.context ?? "",
              cursorX: message.x,
              cursorY: message.y,
              scrollY: message.scrollY ?? 0,
              insideBoard: message.insideBoard,
              lastSeen: message.timestamp,
              focusTicketKey: current.find((item) => item.id === message.user.id)?.focusTicketKey ?? "",
              focusTicketLabel: current.find((item) => item.id === message.user.id)?.focusTicketLabel ?? "",
            };
            registerPeerSeen(peer);
            return upsertCollaboratorEntry(current, peer);
          }
        );
        return;
      }

      if (message.type === "focus") {
        setLocalCollaborators((current) =>
          {
            const peer = {
              ...message.user,
              page: message.page,
              context: current.find((item) => item.id === message.user.id)?.context ?? "",
              cursorX: current.find((item) => item.id === message.user.id)?.cursorX ?? 50,
              cursorY: current.find((item) => item.id === message.user.id)?.cursorY ?? 50,
              scrollY: current.find((item) => item.id === message.user.id)?.scrollY ?? 0,
              insideBoard: current.find((item) => item.id === message.user.id)?.insideBoard ?? false,
              lastSeen: message.timestamp,
              focusTicketKey: message.focusTicketKey,
              focusTicketLabel: message.focusTicketLabel,
            };
            registerPeerSeen(peer);
            if (message.focusTicketLabel) {
              pushCollabFeed(
                `focus:${message.user.id}:${message.timestamp}`,
                `${message.user.name} regarde ${message.focusTicketLabel}.`,
                "info",
                message.user.color,
                message.timestamp
              );
            }
            return upsertCollaboratorEntry(current, peer);
          }
        );
      }
    };

    const heartbeat = window.setInterval(() => {
      broadcastPresence();
      setLocalCollaborators((current) => {
        const stale = current.filter((item) => Date.now() - item.lastSeen >= collabPresenceTimeoutMs);
        stale.forEach((item) => unregisterPeer(item.id, item.name, item.color));
        return current.filter((item) => Date.now() - item.lastSeen < collabPresenceTimeoutMs);
      });
    }, 2500);

    const handleBeforeUnload = () => {
      channel.postMessage({
        type: "leave",
        userId: collabIdentity.id,
        timestamp: Date.now(),
      } satisfies CollabMessage);
    };

    broadcastPresence();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload();
      channel.close();
      if (collabChannelRef.current === channel) {
        collabChannelRef.current = null;
      }
    };
  }, [collabIdentity]);

  useEffect(() => {
    if (!currentAccount) {
      setRemoteCollaborators([]);
      setCollabError("");
      setCollabConnectionState("connecting");
      knownPeerIdsRef.current.clear();
      pushSupabasePresenceRef.current = null;
      return;
    }

    let active = true;
    let subscribed = false;

    const channel = supabase.channel(SUPABASE_COLLAB_CHANNEL, {
      config: {
        broadcast: {
          self: false,
        },
      },
    });

    supabaseChannelRef.current = channel;

    const publishPresence = (event: "heartbeat" | "pointer" | "focus" = "heartbeat") => {
      if (!subscribed || !active) {
        return;
      }

      const identity = collabIdentityRef.current;
      const pointer = collabPointerStateRef.current;
      const focus = collabFocusRef.current;

      void channel
        .send({
          type: "broadcast",
          event,
          payload: buildSupabasePresencePayload(
            identity,
            pageRef.current,
            selectedMonthRef.current,
            pointer,
            focus,
            sharedNoteRef.current,
            collabNoteTimestampRef.current
          ),
        })
        .then(() => {
          if (active) {
            setCollabError("");
          }
        })
        .catch((error) => {
          if (active) {
            setCollabError(getErrorMessage(error));
          }
        });
    };

    const applyRemotePayload = (payload: unknown) => {
      if (!active) {
        return;
      }

      const peer = normalizeRemoteCollaborator(payload);
      if (!peer || peer.id === collabIdentityRef.current.id) {
        return;
      }

      registerPeerSeen(peer);
      setRemoteCollaborators((current) =>
        pruneRemoteCollaborators(upsertCollaboratorEntry(current, peer))
      );

      if (!payload || typeof payload !== "object") {
        return;
      }

      const row = payload as Record<string, unknown>;
      const noteTimestamp = toNumber(row.sharedNoteUpdatedAt ?? row.timestamp ?? 0);
      const noteText = String(row.sharedNoteText ?? row.note ?? "");
      const author = String(row.sharedNoteUpdatedBy ?? row.name ?? "Une autre session");

      if (noteText && noteTimestamp > collabNoteTimestampRef.current) {
        collabNoteTimestampRef.current = noteTimestamp;
        setSharedNote(noteText);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(collabSharedNoteStorageKey, noteText);
        }

        if (author !== collabIdentityRef.current.name) {
          setCollabStatus(`${author} a mis a jour le bloc note partage.`);
          pushCollabFeed(
            `note:${peer.id}:${noteTimestamp}`,
            `${author} a mis a jour le bloc-note partage.`,
            "info",
            peer.color,
            noteTimestamp
          );
        }
      }
    };

    channel.on("broadcast", { event: "heartbeat" }, ({ payload }) => {
      applyRemotePayload(payload);
    });

    channel.on("broadcast", { event: "pointer" }, ({ payload }) => {
      applyRemotePayload(payload);
    });

    channel.on("broadcast", { event: "focus" }, ({ payload }) => {
      applyRemotePayload(payload);
    });

    channel.on("broadcast", { event: "note" }, ({ payload }) => {
      applyRemotePayload(payload);
    });

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      const row = payload as Record<string, unknown>;
      const id = String(row.signalId ?? "");
      const kind = String(row.kind ?? "ping") as CollabSignalKind;
      const author = String(row.name ?? "Une session");
      const color = String(row.color ?? collabColors[0]);
      const x = toNumber(row.x ?? row.cursorX ?? 50);
      const y = toNumber(row.y ?? row.cursorY ?? 50);
      const timestamp = toNumber(row.timestamp ?? Date.now());

      if (!id) {
        return;
      }

      pushSignal(id, kind, author, color, x, y, timestamp);
    });

    channel.on("broadcast", { event: "history" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      const row = payload as Record<string, unknown>;
      const senderId = String(row.id ?? "");
      const senderName = String(row.name ?? "Une session");

      if (!senderId || senderId === collabIdentityRef.current.id) {
        return;
      }

      const rawEvent = row.historyEvent as Record<string, unknown> | undefined;
      if (!rawEvent || typeof rawEvent !== "object") {
        return;
      }

      pushHistoryEvent(
        {
          tone: (rawEvent.tone as HistoryEvent["tone"]) ?? "info",
          source: (rawEvent.source as HistoryEvent["source"]) ?? "app",
          title: String(rawEvent.title ?? "Action distante"),
          detail: String(rawEvent.detail ?? ""),
          shortcut: (rawEvent.shortcut as HistoryEvent["shortcut"]) ?? null,
          author: senderName,
        },
        { broadcast: false, createdAt: toNumber(row.timestamp ?? Date.now()) }
      );
    });

    channel.on("broadcast", { event: "leave" }, ({ payload }) => {
      const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
      const id = String(row?.id ?? "");
      const name = String(row?.name ?? "Une session");
      const color = String(row?.color ?? collabColors[0]);

      if (!id) {
        return;
      }

      unregisterPeer(id, name, color);
      setRemoteCollaborators((current) => current.filter((item) => item.id !== id));
    });

    channel.on("broadcast", { event: "subscriptions" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const senderId = String(row.id ?? "");
      if (!senderId || senderId === collabIdentityRef.current.id) return;
      const rawSubs = row.subscriptions;
      if (!Array.isArray(rawSubs)) return;
      const subs: DashboardSubscription[] = rawSubs
        .filter((s: unknown) => s && typeof s === "object" && "id" in (s as Record<string, unknown>) && "label" in (s as Record<string, unknown>) && "amount" in (s as Record<string, unknown>))
        .map((s: unknown) => {
          const item = s as Record<string, unknown>;
          return { id: String(item.id), label: String(item.label), amount: Number(item.amount) };
        });
      setDashboardSubscriptions(subs);
      window.localStorage.setItem(dashboardSubscriptionsStorageKey, JSON.stringify(subs));
    });

    channel.on("broadcast", { event: "role-update" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const targetEmail = String(row.targetEmail ?? "");
      const newRole = String(row.newRole ?? "");
      if (!targetEmail || !newRole) return;
      const updatedRole = targetEmail === FOUNDER_EMAIL ? "founder" as const : newRole === "admin" ? "admin" as const : "user" as const;
      const rolePermissions =
        updatedRole === "admin" || updatedRole === "founder"
          ? defaultAdminPagePermissions
          : defaultUserPagePermissions;

      setAdminUsers((current) =>
        current.map((user) =>
          user.email === targetEmail
            ? normalizeAccountProfile({ ...user, role: updatedRole, pagePermissions: rolePermissions }) ?? user
            : user
        )
      );

      setCurrentAccount((prev) => {
        if (!prev || prev.email !== targetEmail) return prev;
        const updated = normalizeAccountProfile({
          ...prev,
          role: updatedRole,
          pagePermissions: rolePermissions,
        }) ?? prev;
        persistSessionAccount(updated);
        return updated;
      });
    });

    channel.on("broadcast", { event: "permissions-update" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") return;
      const row = payload as Record<string, unknown>;
      const targetEmail = String(row.targetEmail ?? "");
      const pagePermissions = normalizePagePermissions(
        row.pagePermissions ?? row.page_permissions,
        defaultUserPagePermissions
      );
      if (!targetEmail) return;

      applyPermissionsUpdate(targetEmail, pagePermissions);
    });

    channel.on("broadcast", { event: "import-session" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      const row = payload as Record<string, unknown>;
      const senderId = String(row.id ?? "");

      if (!senderId || senderId === collabIdentityRef.current.id) {
        return;
      }

      applyIncomingSharedCsvImportSession(
        normalizeCsvImportSession(row.importSession ?? null),
        toNumber(row.timestamp ?? Date.now())
      );
    });

    channel.subscribe((status) => {
      if (!active) {
        return;
      }

      if (status === "SUBSCRIBED") {
        subscribed = true;
        setCollabConnectionState("live");
        setCollabStatus("Collab temps reel connectee.");
        setCollabError("");
        pushCollabFeed(
          `realtime:${collabIdentityRef.current.id}:${Date.now()}`,
          "Connexion live etablie. La collab est en temps reel.",
          "ok",
          collabIdentityRef.current.color
        );
        publishPresence("heartbeat");

        // Récupérer les events manqués des dernières 24h
        const since = Date.now() - 24 * 60 * 60 * 1000;
        void supabase
          .from("collab_history_events")
          .select("*")
          .gte("timestamp", since)
          .neq("user_id", collabIdentityRef.current.id)
          .order("timestamp", { ascending: true })
          .then(({ data }) => {
            if (!data || !active) return;
            data.forEach((row) => {
              pushHistoryEvent(
                {
                  tone: row.event_tone as HistoryEvent["tone"],
                  source: row.event_source as HistoryEvent["source"],
                  title: row.event_title,
                  detail: row.event_detail,
                  shortcut: (row.event_shortcut as HistoryEvent["shortcut"]) ?? null,
                  author: row.user_name,
                },
                { broadcast: false, createdAt: row.timestamp, silent: true }
              );
            });
          });

        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setCollabConnectionState("unstable");
        setCollabError("Connexion temps reel instable. Verifie internet ou la config Supabase.");
      }

      if (status === "CLOSED") {
        subscribed = false;
        setCollabConnectionState("connecting");
      }
    });

    pushSupabasePresenceRef.current = publishPresence;

    const heartbeat = window.setInterval(() => {
      publishPresence("heartbeat");
      setRemoteCollaborators((current) => {
        const next = pruneRemoteCollaborators(current);
        current
          .filter((item) => !next.some((candidate) => candidate.id === item.id))
          .forEach((item) => unregisterPeer(item.id, item.name, item.color));
        return next;
      });
    }, 1800);

    return () => {
      active = false;
      subscribed = false;
      window.clearInterval(heartbeat);
      setRemoteCollaborators([]);
      setCollabConnectionState("connecting");
      pushSupabasePresenceRef.current = null;

      void channel.send({
        type: "broadcast",
        event: "leave",
        payload: {
          id: collabIdentityRef.current.id,
          name: collabIdentityRef.current.name,
          color: collabIdentityRef.current.color,
        },
      }).catch(() => {});
      void supabase.removeChannel(channel);

      if (supabaseChannelRef.current === channel) {
        supabaseChannelRef.current = null;
      }
    };
  }, [currentAccount, collabIdentity.id]);

  useEffect(() => {
    if (!currentAccount) {
      return;
    }

    pushSupabasePresenceRef.current?.("heartbeat");
  }, [currentAccount, collabIdentity, page, selectedMonth]);

  useEffect(() => {
    const loadTickets = async () => {
      if (!currentAccount) {
        setTickets([]);
        setTicketMonthSummary(null);
        setReimbursementDetails(createEmptyReimbursementDetails());
        setLastTicketsSyncAt(null);
        setLoadingTickets(false);
        setRefreshingTickets(false);
        return;
      }

      const cachedMonth = monthDataCacheRef.current[selectedMonth];
      const reloadRequested = lastTicketReloadSeedRef.current !== reloadSeed;

      if (cachedMonth) {
        setTickets(cachedMonth.tickets);
        setTicketMonthSummary(cachedMonth.summary);
        setReimbursementDetails(cachedMonth.reimbursements);
        setLastTicketsSyncAt(cachedMonth.syncedAt);
        lastLoadedMonthRef.current = selectedMonth;
      } else {
        setLastTicketsSyncAt(null);
      }

      if (cachedMonth && !reloadRequested) {
        setLoadingTickets(false);
        setRefreshingTickets(false);
        setTicketsError("");
        return;
      }

      try {
        lastTicketReloadSeedRef.current = reloadSeed;

        if (!cachedMonth) {
          setLoadingTickets(true);
        } else {
          setRefreshingTickets(true);
        }
        setTicketsError("");

        const data = await fetchTicketsFromSheets(selectedMonth);
        const normalized = normalizeMonthDataPayload(data);
        const syncedAt = Date.now();

        monthDataCacheRef.current[selectedMonth] = {
          tickets: normalized.tickets,
          summary: normalized.summary,
          reimbursements: normalized.reimbursements,
          syncedAt,
        };

        setTickets(normalized.tickets);
        setTicketMonthSummary(normalized.summary);
        setReimbursementDetails(normalized.reimbursements);
        lastLoadedMonthRef.current = selectedMonth;
        setLastTicketsSyncAt(syncedAt);
      } catch (error) {
        console.error("Chargement Google Sheets impossible:", error);
        setTicketsError(getErrorMessage(error));
        if (!cachedMonth) {
          setTickets([]);
          setTicketMonthSummary(null);
          setReimbursementDetails(createEmptyReimbursementDetails());
          setLastTicketsSyncAt(null);
        }
      } finally {
        setLoadingTickets(false);
        setRefreshingTickets(false);
        const cb = onReloadDoneRef.current;
        if (cb) {
          onReloadDoneRef.current = null;
          cb();
        }
      }
    };

    loadTickets();
  }, [currentAccount, selectedMonth, reloadSeed]);

  useEffect(() => {
    if (page !== "compare") {
      return;
    }

    if (!currentAccount) {
      setCompareMonthStates({});
      return;
    }

    let cancelled = false;
    const monthsToLoad = [...new Set([comparePrimaryMonth, compareSecondaryMonth])];
    const reloadRequested = lastCompareReloadSeedRef.current !== compareReloadSeed;
    lastCompareReloadSeedRef.current = compareReloadSeed;

    monthsToLoad.forEach((month) => {
      const cachedMonth = monthDataCacheRef.current[month];

      if (cachedMonth) {
        setCompareMonthStates((prev) => ({
          ...prev,
          [month]: {
            tickets: cachedMonth.tickets,
            summary: cachedMonth.summary,
            loading: false,
            error: "",
            syncedAt: cachedMonth.syncedAt,
          },
        }));
      }

      if (cachedMonth && !reloadRequested) {
        return;
      }

      setCompareMonthStates((prev) => ({
        ...prev,
        [month]: {
          ...createEmptyCompareMonthState(),
          ...(prev[month] ?? {}),
          loading: !cachedMonth,
          error: "",
        },
      }));

      void fetchTicketsFromSheets(month)
        .then((data) => {
          const normalized = normalizeMonthDataPayload(data);
          const syncedAt = Date.now();

          monthDataCacheRef.current[month] = {
            tickets: normalized.tickets,
            summary: normalized.summary,
            reimbursements: normalized.reimbursements,
            syncedAt,
          };

          if (cancelled) {
            return;
          }

          setCompareMonthStates((prev) => ({
            ...prev,
            [month]: {
              tickets: normalized.tickets,
              summary: normalized.summary,
              loading: false,
              error: "",
              syncedAt,
            },
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setCompareMonthStates((prev) => ({
            ...prev,
            [month]: {
              ...createEmptyCompareMonthState(),
              ...(prev[month] ?? {}),
              loading: false,
              error: getErrorMessage(error),
              syncedAt: Date.now(),
            },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [
    page,
    currentAccount,
    comparePrimaryMonth,
    compareSecondaryMonth,
    compareReloadSeed,
  ]);

  useEffect(() => {
    if (page !== "audits") {
      return;
    }

    if (!currentAccount) {
      return;
    }

    if (auditReferenceMonth === selectedMonth) {
      return;
    }

    let cancelled = false;
    const cachedMonth = monthDataCacheRef.current[auditReferenceMonth];
    const reloadRequested = lastAuditReloadSeedRef.current !== auditReloadSeed;
    lastAuditReloadSeedRef.current = auditReloadSeed;

    if (cachedMonth) {
      setCompareMonthStates((prev) => ({
        ...prev,
        [auditReferenceMonth]: {
          tickets: cachedMonth.tickets,
          summary: cachedMonth.summary,
          loading: false,
          error: "",
          syncedAt: cachedMonth.syncedAt,
        },
      }));
    }

    if (cachedMonth && !reloadRequested) {
      return;
    }

    setCompareMonthStates((prev) => ({
      ...prev,
      [auditReferenceMonth]: {
        ...createEmptyCompareMonthState(),
        ...(prev[auditReferenceMonth] ?? {}),
        loading: !cachedMonth,
        error: "",
      },
    }));

    void fetchTicketsFromSheets(auditReferenceMonth)
      .then((data) => {
        const normalized = normalizeMonthDataPayload(data);
        const syncedAt = Date.now();

        monthDataCacheRef.current[auditReferenceMonth] = {
          tickets: normalized.tickets,
          summary: normalized.summary,
          reimbursements: normalized.reimbursements,
          syncedAt,
        };

        if (cancelled) {
          return;
        }

        setCompareMonthStates((prev) => ({
          ...prev,
          [auditReferenceMonth]: {
            tickets: normalized.tickets,
            summary: normalized.summary,
            loading: false,
            error: "",
            syncedAt,
          },
        }));
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setCompareMonthStates((prev) => ({
          ...prev,
          [auditReferenceMonth]: {
            ...createEmptyCompareMonthState(),
            ...(prev[auditReferenceMonth] ?? {}),
            loading: false,
            error: getErrorMessage(loadError),
            syncedAt: Date.now(),
          },
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    page,
    currentAccount,
    auditReferenceMonth,
    selectedMonth,
    auditReloadSeed,
  ]);

  useEffect(() => {
    collabChannelRef.current?.postMessage({
      type: "presence",
      user: collabIdentity,
      page,
      context: getPresenceContext(page, selectedMonth),
      timestamp: Date.now(),
    } satisfies CollabMessage);
  }, [collabIdentity, page, selectedMonth]);

  useEffect(() => {
    if (page !== "tickets") {
      broadcastTicketFocus("", "");
    }
  }, [page]);

  useEffect(() => {
    if (!currentAccount || canAccessPage(currentAccount, page)) {
      return;
    }

    setPage(getFirstAccessiblePage(currentAccount));
  }, [currentAccount, page]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const triggerRefresh = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastPassiveRefreshAtRef.current < 90_000) {
          return;
        }

        lastPassiveRefreshAtRef.current = now;
        setReloadSeed((value) => value + 1);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };

    const interval = window.setInterval(() => {
      if (pageRef.current === "dashboard" || pageRef.current === "tickets") {
        triggerRefresh();
      }
    }, 120000);

    window.addEventListener("focus", triggerRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", triggerRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleAddSubscription = () => {
    const label = subFormLabel.trim();
    const amount = parseFloat(subFormAmount.replace(",", "."));
    if (!label && !subFormAmount.trim()) {
      setSubFormError("Remplis le nom et le prix de l\u2019abonnement.");
      return;
    }
    if (!label) {
      setSubFormError("Le nom ne peut pas \u00eatre vide.");
      return;
    }
    if (/\d/.test(label)) {
      setSubFormError("Le nom ne doit pas contenir de chiffres.");
      return;
    }
    if (!subFormAmount.trim()) {
      setSubFormError("Indique un prix mensuel.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setSubFormError("Le prix doit \u00eatre un nombre valide (ex: 9,99).");
      return;
    }
    setSubFormError("");
    const next: DashboardSubscription = {
      id: crypto.randomUUID(),
      label,
      amount,
    };
    setDashboardSubscriptions((prev) => {
      const updated = [...prev, next];
      window.localStorage.setItem(dashboardSubscriptionsStorageKey, JSON.stringify(updated));
      return updated;
    });
    setSubFormLabel("");
    setSubFormAmount("");
    setSubPanelOpen(false);
    pushHistoryEvent({
      tone: "ok",
      source: "app",
      shortcut: null,
      title: "Abonnement ajoute",
      detail: `${label} • ${euro.format(amount)}/mois`,
    });
    // Broadcast updated list to other users
    const updatedList = [...dashboardSubscriptions, next];
    collabChannelRef.current?.postMessage({
      type: "subscriptions",
      user: collabIdentityRef.current,
      subscriptions: updatedList,
      timestamp: Date.now(),
    } satisfies CollabMessage);
    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "subscriptions",
      payload: {
        id: collabIdentityRef.current.id,
        subscriptions: updatedList,
      },
    });
  };

  const handleDeleteSubscription = (id: string) => {
    const target = dashboardSubscriptions.find((s) => s.id === id);
    setDashboardSubscriptions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      window.localStorage.setItem(dashboardSubscriptionsStorageKey, JSON.stringify(updated));
      return updated;
    });
    if (target) {
      pushHistoryEvent({
        tone: "warn",
        source: "app",
        shortcut: null,
        title: "Abonnement supprime",
        detail: `${target.label} • ${euro.format(target.amount)}/mois`,
      });
    }
    // Broadcast updated list to other users
    const updatedList = dashboardSubscriptions.filter((s) => s.id !== id);
    collabChannelRef.current?.postMessage({
      type: "subscriptions",
      user: collabIdentityRef.current,
      subscriptions: updatedList,
      timestamp: Date.now(),
    } satisfies CollabMessage);
    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "subscriptions",
      payload: {
        id: collabIdentityRef.current.id,
        subscriptions: updatedList,
      },
    });
  };

  const handleOpenTicketModal = () => {
    setSubmitTicketError("");
    setTicketCategoryPromptOpen(false);
    setTicketFollowUpPrompt(null);
    updateNewTicketForm((current) => ({
      ...current,
      date: current.date || new Date().toISOString().slice(0, 10),
      description: "",
      amount: "",
      category: "",
    }));
    setVoiceTranscript("");
    setVoiceStep("date");
    setVoiceFeedback("");
    setIsTicketModalOpen(true);
  };

  const handleCloseTicketModal = () => {
    if (submittingTicket) {
      return;
    }

    setIsTicketModalOpen(false);
    setSubmitTicketError("");
    setVoiceFeedback("");
    setVoiceTranscript("");
    setTicketCategoryPromptOpen(false);
    setTicketFollowUpPrompt(null);
    stopTicketVoiceSession();
    setVoiceStep("date");
  };

  const handleRefreshTickets = () => {
    setReloadSeed((value) => value + 1);
  };

  const syncCsvImportStateFromSession = (
    session: SharedCsvImportSession | null,
    options?: { openModal?: boolean; resetError?: boolean }
  ) => {
    setSharedCsvImportSession(session);
    sharedCsvImportSessionRef.current = session;

    if (!session) {
      setCsvImportModalOpen(options?.openModal ?? false);
      setCsvImportDrafts([]);
      setCsvImportSummary(createEmptyCsvImportSummary());
      setCsvImportTargetMonth(selectedMonthRef.current);
      setCsvImportFileName("");
      setCsvImportStatus("");
      if (options?.resetError !== false) {
        setCsvImportError("");
      }
      return;
    }

    setCsvImportDrafts(session.drafts);
    setCsvImportSummary(session.summary);
    setCsvImportTargetMonth(session.targetMonth);
    setCsvImportFileName(session.fileName);
    setCsvImportStatus(session.status);
    setCsvImportModalOpen(
      options?.openModal ??
        session.participants.some((participant) => participant.id === collabIdentityRef.current.id)
    );

    if (options?.resetError !== false) {
      setCsvImportError("");
    }
  };

  const broadcastCsvImportSession = (
    session: SharedCsvImportSession | null,
    timestamp: number
  ) => {
    collabChannelRef.current?.postMessage({
      type: "importSession",
      user: collabIdentityRef.current,
      session,
      timestamp,
    } satisfies CollabMessage);

    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "import-session",
      payload: {
        id: collabIdentityRef.current.id,
        name: collabIdentityRef.current.name,
        color: collabIdentityRef.current.color,
        seed: collabIdentityRef.current.seed,
        importSession: session,
        timestamp,
      },
    });
  };

  const applySharedCsvImportSession = (
    session: SharedCsvImportSession | null,
    options?: { openModal?: boolean; broadcast?: boolean; timestamp?: number; resetError?: boolean }
  ) => {
    const eventAt = options?.timestamp ?? session?.updatedAt ?? Date.now();
    lastCsvImportSessionEventAtRef.current = eventAt;
    syncCsvImportStateFromSession(session, {
      openModal: options?.openModal,
      resetError: options?.resetError,
    });

    if (options?.broadcast !== false) {
      broadcastCsvImportSession(session, eventAt);
    }
  };

  const updateSharedCsvImportSession = (
    updater: (current: SharedCsvImportSession | null) => SharedCsvImportSession | null,
    options?: { openModal?: boolean; broadcast?: boolean; resetError?: boolean }
  ) => {
    const current = sharedCsvImportSessionRef.current;
    const next = updater(current);
    applySharedCsvImportSession(next, {
      openModal: options?.openModal,
      broadcast: options?.broadcast,
      resetError: options?.resetError,
      timestamp: next?.updatedAt ?? Date.now(),
    });
  };

  const clearCsvImportState = (options?: { preserveSharedSession?: boolean }) => {
    if (!options?.preserveSharedSession) {
      setSharedCsvImportSession(null);
      sharedCsvImportSessionRef.current = null;
      lastCsvImportSessionEventAtRef.current = Date.now();
    }

    setCsvImportModalOpen(false);
    setCsvImportDrafts([]);
    setCsvImportSummary(createEmptyCsvImportSummary());
    setCsvImportTargetMonth(selectedMonthRef.current);
    setCsvImportFileName("");
    setCsvImportLoading(false);
    setCsvImportSubmitting(false);
    setCsvImportError("");
    setCsvImportStatus("");

    if (csvImportInputRef.current) {
      csvImportInputRef.current.value = "";
    }
  };

  const applyIncomingSharedCsvImportSession = (
    session: SharedCsvImportSession | null,
    timestamp: number
  ) => {
    if (timestamp < lastCsvImportSessionEventAtRef.current) {
      return;
    }

    lastCsvImportSessionEventAtRef.current = timestamp;
    syncCsvImportStateFromSession(session, {
      openModal: Boolean(
        session?.participants.some((participant) => participant.id === collabIdentityRef.current.id)
      ),
      resetError: true,
    });

    if (!session) {
      setCsvImportLoading(false);
      setCsvImportSubmitting(false);
    }
  };

  const loadExistingTicketsForCsvMonth = async (
    month: string,
    options?: { forceRefresh?: boolean }
  ) => {
    if (month === selectedMonthRef.current && !options?.forceRefresh) {
      return ticketsRef.current;
    }

    const cachedMonth = monthDataCacheRef.current[month];

    if (cachedMonth && !options?.forceRefresh) {
      return cachedMonth.tickets;
    }

    const data = await fetchTicketsFromSheets(month);
    const normalized = normalizeMonthDataPayload(data);
    const syncedAt = Date.now();

    monthDataCacheRef.current[month] = {
      tickets: normalized.tickets,
      summary: normalized.summary,
      reimbursements: normalized.reimbursements,
      syncedAt,
    };

    return normalized.tickets;
  };

  const handleOpenSharedCsvImportSession = () => {
    const currentSession = sharedCsvImportSessionRef.current;

    if (!currentSession || csvImportSubmitting) {
      return;
    }

    const now = Date.now();
    const nextSession: SharedCsvImportSession = {
      ...currentSession,
      participants: upsertCsvImportParticipant(
        currentSession.participants,
        createCsvImportParticipant(collabIdentityRef.current, now)
      ),
      updatedAt: now,
    };

    applySharedCsvImportSession(nextSession, {
      openModal: true,
      broadcast: true,
      resetError: true,
      timestamp: now,
    });
  };

  const handleOpenCsvImportPicker = () => {
    if (csvImportSubmitting) {
      return;
    }

    if (sharedCsvImportSessionRef.current) {
      handleOpenSharedCsvImportSession();
      return;
    }

    if (csvImportInputRef.current) {
      csvImportInputRef.current.value = "";
      csvImportInputRef.current.click();
    }
  };

  const handleCloseCsvImportModal = () => {
    if (
      csvImportSubmitting ||
      (sharedCsvImportSessionRef.current?.submittingById &&
        sharedCsvImportSessionRef.current.submittingById !== collabIdentityRef.current.id)
    ) {
      return;
    }

    const currentSession = sharedCsvImportSessionRef.current;

    if (!currentSession) {
      clearCsvImportState();
      return;
    }

    const remainingParticipants = currentSession.participants.filter(
      (participant) => participant.id !== collabIdentityRef.current.id
    );

    if (remainingParticipants.length === 0) {
      applySharedCsvImportSession(null, {
        openModal: false,
        broadcast: true,
        resetError: true,
        timestamp: Date.now(),
      });
      setCsvImportLoading(false);
      setCsvImportSubmitting(false);
      return;
    }

    const nextOwner =
      currentSession.ownerId === collabIdentityRef.current.id
        ? remainingParticipants[0]
        : remainingParticipants.find((participant) => participant.id === currentSession.ownerId) ?? {
            id: currentSession.ownerId,
            name: currentSession.ownerName,
            color: currentSession.ownerColor,
            lastSeen: currentSession.updatedAt,
          };

    const now = Date.now();
    const nextSession: SharedCsvImportSession = {
      ...currentSession,
      ownerId: nextOwner.id,
      ownerName: nextOwner.name,
      ownerColor: nextOwner.color,
      participants: remainingParticipants,
      updatedAt: now,
      status:
        currentSession.ownerId === collabIdentityRef.current.id
          ? `${nextOwner.name} continue l import partage.`
          : currentSession.status,
    };

    applySharedCsvImportSession(nextSession, {
      openModal: false,
      broadcast: true,
      resetError: true,
      timestamp: now,
    });
    setCsvImportLoading(false);
    setCsvImportSubmitting(false);
  };

  const handleCsvImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      setCsvImportLoading(true);
      setCsvImportError("");
      setCsvImportStatus("");

      const csvText = await file.text();
      const accountIdentity = currentAccount
        ? {
            firstName: currentAccount.firstName,
            lastName: currentAccount.lastName,
            pseudo: currentAccount.pseudo,
            email: currentAccount.email,
          }
        : null;

      const preview = parseRevolutCsvImport(
        csvText,
        selectedMonth,
        [],
        accountIdentity
      );
      const existingTicketsForTargetMonth = await loadExistingTicketsForCsvMonth(preview.targetMonth, {
        forceRefresh: true,
      });
      const parsed = parseRevolutCsvImport(
        csvText,
        selectedMonth,
        existingTicketsForTargetMonth,
        accountIdentity
      );
      const targetMonthLabel = getSelectedMonthLabel(parsed.targetMonth);
      const currentMonthLabel = getSelectedMonthLabel(selectedMonthRef.current);
      const now = Date.now();
      const session: SharedCsvImportSession = {
        id: createCsvImportDraftId("session"),
        ownerId: collabIdentityRef.current.id,
        ownerName: collabIdentityRef.current.name,
        ownerColor: collabIdentityRef.current.color,
        submittingById: "",
        submittingByName: "",
        fileName: file.name,
        targetMonth: parsed.targetMonth,
        summary: parsed.summary,
        drafts: parsed.drafts,
        participants: [createCsvImportParticipant(collabIdentityRef.current, now)],
        status:
          parsed.drafts.length === 0
            ? `Aucune nouvelle ligne a importer pour ${targetMonthLabel}.`
            : parsed.targetMonth === selectedMonthRef.current
              ? `${parsed.drafts.length} nouvelle(s) ligne(s) detectee(s) pour ${targetMonthLabel}.`
              : `${parsed.drafts.length} nouvelle(s) ligne(s) detectee(s) pour ${targetMonthLabel}. Vue actuelle: ${currentMonthLabel}.`,
        startedAt: now,
        updatedAt: now,
      };

      applySharedCsvImportSession(session, {
        openModal: true,
        broadcast: true,
        resetError: true,
        timestamp: now,
      });
    } catch (error) {
      if (sharedCsvImportSessionRef.current) {
        syncCsvImportStateFromSession(sharedCsvImportSessionRef.current, {
          openModal: false,
          resetError: true,
        });
        setCsvImportLoading(false);
        setCsvImportSubmitting(false);
      } else {
        clearCsvImportState();
      }
      pushHistoryEvent(
        {
          tone: "warn",
          source: "app",
          title: "Import CSV impossible",
          detail: getErrorMessage(error),
          shortcut: null,
        },
        { broadcast: false }
      );
    } finally {
      setCsvImportLoading(false);
    }
  };

  const handleCsvImportDraftChange = (
    id: string,
    patch: Partial<Pick<CsvImportDraft, "date" | "amount" | "description" | "category">>
  ) => {
    updateSharedCsvImportSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                ...patch,
                error: "",
              }
            : draft
        ),
        participants: upsertCsvImportParticipant(
          current.participants,
          createCsvImportParticipant(collabIdentityRef.current)
        ),
        updatedAt: Date.now(),
      };
    }, { openModal: true, broadcast: true, resetError: true });
    setCsvImportError("");
  };

  const handleCsvImportDraftIncludeChange = (id: string, include: boolean) => {
    updateSharedCsvImportSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                include,
                error: "",
              }
            : draft
        ),
        participants: upsertCsvImportParticipant(
          current.participants,
          createCsvImportParticipant(collabIdentityRef.current)
        ),
        updatedAt: Date.now(),
      };
    }, { openModal: true, broadcast: true, resetError: true });
    setCsvImportError("");
  };

  const handleCsvImportSelectAll = (include: boolean) => {
    updateSharedCsvImportSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        drafts: current.drafts.map((draft) => ({
          ...draft,
          include,
          error: "",
        })),
        participants: upsertCsvImportParticipant(
          current.participants,
          createCsvImportParticipant(collabIdentityRef.current)
        ),
        updatedAt: Date.now(),
      };
    }, { openModal: true, broadcast: true, resetError: true });
    setCsvImportError("");
  };

  const handleConfirmCsvImport = async () => {
    const currentSession = sharedCsvImportSessionRef.current;
    const activeSubmitterName =
      currentSession?.submittingById &&
      currentSession.submittingById !== collabIdentityRef.current.id
        ? currentSession.submittingByName || currentSession.ownerName
        : "";

    if (activeSubmitterName) {
      setCsvImportError(`${activeSubmitterName} importe deja ce lot.`);
      return;
    }

    const normalizedDrafts = csvImportDrafts.map((draft) => {
      if (!draft.include) {
        return {
          ...draft,
          error: "",
        };
      }

      const date = draft.date.trim();
      const description = draft.description.trim();
      const category = draft.category.trim();
      const amount = draft.amount.trim();
      const amountValue = Math.abs(toNumber(amount));
      let error = "";

      if (!date) {
        error = "Date requise.";
      } else if (!description) {
        error = "Description requise.";
      } else if (!(amountValue > 0)) {
        error = "Montant invalide.";
      } else if (!category) {
        error = "Categorie requise.";
      }

      return {
        ...draft,
        date,
        description,
        category,
        amount,
        error,
      };
    });

    const draftsToImport = normalizedDrafts.filter((draft) => draft.include);

    if (draftsToImport.length === 0) {
      updateSharedCsvImportSession(
        (current) =>
          current
            ? {
                ...current,
                drafts: normalizedDrafts,
                participants: upsertCsvImportParticipant(
                  current.participants,
                  createCsvImportParticipant(collabIdentityRef.current)
                ),
                updatedAt: Date.now(),
              }
            : current,
        { openModal: true, broadcast: true, resetError: false }
      );
      setCsvImportError("Aucune ligne n est selectionnee.");
      return;
    }

    if (normalizedDrafts.some((draft) => draft.include && draft.error)) {
      updateSharedCsvImportSession(
        (current) =>
          current
            ? {
                ...current,
                drafts: normalizedDrafts,
                participants: upsertCsvImportParticipant(
                  current.participants,
                  createCsvImportParticipant(collabIdentityRef.current)
                ),
                updatedAt: Date.now(),
              }
            : current,
        { openModal: true, broadcast: true, resetError: false }
      );
      setCsvImportError("Corrige les lignes signalees avant l import.");
      return;
    }

    setCsvImportSubmitting(true);
    setCsvImportError("");
    setCsvImportStatus("");
    updateSharedCsvImportSession(
      (current) =>
        current
          ? {
              ...current,
              drafts: normalizedDrafts,
              submittingById: collabIdentityRef.current.id,
              submittingByName: collabIdentityRef.current.name,
              participants: upsertCsvImportParticipant(
                current.participants,
                createCsvImportParticipant(collabIdentityRef.current)
              ),
              status: `${collabIdentityRef.current.name} importe ${draftsToImport.length} ticket(s)...`,
              updatedAt: Date.now(),
            }
          : current,
      { openModal: true, broadcast: true, resetError: true }
    );

    const successIds = new Set<string>();
    const failedById = new Map<string, string>();

    try {
      for (const draft of draftsToImport) {
        try {
          await createTicketInSheets(csvImportTargetMonth, {
            date: draft.date,
            amount: formatCsvImportAmount(Math.abs(toNumber(draft.amount))),
            description: draft.description,
            category: draft.category,
          });
          successIds.add(draft.id);
        } catch (error) {
          failedById.set(draft.id, getErrorMessage(error));
        }
      }

      const successCount = successIds.size;
      const failedCount = failedById.size;

      if (successCount > 0) {
        delete monthDataCacheRef.current[csvImportTargetMonth];

        if (csvImportTargetMonth === selectedMonthRef.current) {
          setReloadSeed((value) => value + 1);
        }

        pushHistoryEvent(
          {
            tone: failedCount > 0 ? "warn" : "ok",
            source: "app",
            title: "Import CSV termine",
            detail:
              failedCount > 0
                ? `${successCount} ticket(s) importe(s) dans ${getSelectedMonthLabel(csvImportTargetMonth)}, ${failedCount} en echec.`
                : `${successCount} ticket(s) importe(s) dans ${getSelectedMonthLabel(csvImportTargetMonth)} depuis ${csvImportFileName || "le CSV"}.`,
            shortcut: null,
          },
          { broadcast: false }
        );
      }

      const remainingDrafts = normalizedDrafts
        .filter((draft) => !successIds.has(draft.id))
        .map((draft) => ({
          ...draft,
          error: failedById.get(draft.id) ?? "",
        }));

      if (remainingDrafts.length === 0 && successCount > 0) {
        applySharedCsvImportSession(null, {
          openModal: false,
          broadcast: true,
          resetError: true,
          timestamp: Date.now(),
        });
        return;
      }

      if (failedCount > 0) {
        const nextStatus =
          successCount > 0
            ? `${successCount} ticket(s) importe(s) dans ${getSelectedMonthLabel(csvImportTargetMonth)}. ${failedCount} ligne(s) a corriger.`
            : "Aucun ticket importe.";
        updateSharedCsvImportSession(
          (current) =>
            current
              ? {
                  ...current,
                  drafts: remainingDrafts,
                  submittingById: "",
                  submittingByName: "",
                  participants: upsertCsvImportParticipant(
                    current.participants,
                    createCsvImportParticipant(collabIdentityRef.current)
                  ),
                  status: nextStatus,
                  updatedAt: Date.now(),
                }
              : current,
          { openModal: true, broadcast: true, resetError: false }
        );
        if (successCount === 0) {
          setCsvImportError("L import a echoue sur les lignes selectionnees.");
        }
        return;
      }

      if (successCount > 0) {
        updateSharedCsvImportSession(
          (current) =>
            current
              ? {
                  ...current,
                  drafts: remainingDrafts,
                  submittingById: "",
                  submittingByName: "",
                  participants: upsertCsvImportParticipant(
                    current.participants,
                    createCsvImportParticipant(collabIdentityRef.current)
                  ),
                  status: `${successCount} ticket(s) importe(s) dans ${getSelectedMonthLabel(csvImportTargetMonth)}. ${remainingDrafts.length} ligne(s) restent en revue.`,
                  updatedAt: Date.now(),
                }
              : current,
          { openModal: true, broadcast: true, resetError: true }
        );
      }
    } catch (error) {
      setCsvImportError(getErrorMessage(error));
      updateSharedCsvImportSession(
        (current) =>
          current
            ? {
                ...current,
                submittingById: "",
                submittingByName: "",
                participants: upsertCsvImportParticipant(
                  current.participants,
                  createCsvImportParticipant(collabIdentityRef.current)
                ),
                status: "L import CSV a rencontre une erreur.",
                updatedAt: Date.now(),
              }
            : current,
        { openModal: true, broadcast: true, resetError: false }
      );
    } finally {
      setCsvImportSubmitting(false);

      if (sharedCsvImportSessionRef.current?.submittingById === collabIdentityRef.current.id) {
        updateSharedCsvImportSession(
          (current) =>
            current
              ? {
                  ...current,
                  submittingById: "",
                  submittingByName: "",
                  updatedAt: Date.now(),
                }
              : current,
          { openModal: true, broadcast: true, resetError: false }
        );
      }
    }
  };

  const handleAuditReferenceMonthChange = (month: string) => {
    if (month === selectedMonth) {
      return;
    }

    setAuditReferenceMonth(month);
  };

  const handleRefreshAudits = () => {
    setReloadSeed((value) => value + 1);
    setAuditReloadSeed((value) => value + 1);
  };

  const handleComparePrimaryMonthChange = (month: string) => {
    setComparePrimaryMonth(month);
  };

  const handleCompareSecondaryMonthChange = (month: string) => {
    setCompareSecondaryMonth(month);
  };

  const handleSwapCompareMonths = () => {
    setComparePrimaryMonth(compareSecondaryMonth);
    setCompareSecondaryMonth(comparePrimaryMonth);
  };

  const handleSyncCompareWithSelectedMonth = () => {
    setComparePrimaryMonth(selectedMonth);
    if (selectedMonth === compareSecondaryMonth) {
      setCompareSecondaryMonth(getRelativeMonthValue(selectedMonth, -1));
    }
  };

  const handleRefreshCompare = () => {
    setCompareReloadSeed((value) => value + 1);
  };

  const changePageWithHistory = (nextPage: PageKey) => {
    if (nextPage === page) {
      return;
    }

    if (currentAccount && !canAccessPage(currentAccount, nextPage)) {
      setDeniedPageModal(nextPage);
      return;
    }

    pushHistorySnapshot();
    setPage(nextPage);
  };

  const changeMonthWithHistory = (nextMonth: string) => {
    if (nextMonth === selectedMonth) {
      return;
    }

    pushHistorySnapshot();
    setSelectedMonth(nextMonth);
  };

  const handleTicketSearchChange = (value: string) => {
    if (value === ticketSearch) {
      return;
    }

    pushHistorySnapshot();
    setTicketSearch(value);
  };

  const handleTicketCategoryFilterChange = (value: string) => {
    if (value === ticketCategoryFilter) {
      return;
    }

    pushHistorySnapshot();
    setTicketCategoryFilter(value);
  };

  const handleTicketStatusFilterChange = (value: TicketStatusFilter) => {
    if (value === ticketStatusFilter) {
      return;
    }

    pushHistorySnapshot();
    setTicketStatusFilter(value);
  };

  const handleTicketSortModeChange = (value: TicketSortMode) => {
    if (value === ticketSortMode) {
      return;
    }

    pushHistorySnapshot();
    setTicketSortMode(value);
  };

  const handleReimbursementFormChangeWithHistory = (
    patch: Partial<ReimbursementFormLine>
  ) => {
    const nextForm = {
      ...reimbursementForm,
      ...patch,
    };

    if (
      nextForm.category === reimbursementForm.category &&
      nextForm.amount === reimbursementForm.amount
    ) {
      return;
    }

    pushHistorySnapshot();
    setReimbursementForm(nextForm);
    setReimbursementStatus("");
    setReimbursementError("");
  };

  const handleSharedNoteChangeWithHistory = (value: string) => {
    if (value === sharedNote) {
      return;
    }

    pushHistorySnapshot();
    handleSharedNoteChange(value);
  };

  const stopTicketVoiceSession = () => {
    shouldRestartRecognitionRef.current = false;
    recognitionRef.current?.stop();
    setVoiceListening(false);
  };

  const promptManualTicketCategory = (fromVoice = false) => {
    setTicketCategoryPromptOpen(true);
    setSubmitTicketError("");
    if (fromVoice) {
      setVoiceFeedback("Je n ai pas trouve la categorie. Choisis-la dans le menu deroulant puis dis valider.");
    }
  };

  const handleNewTicketFormChange = (patch: Partial<NewTicketForm>) => {
    updateNewTicketForm((current) => ({ ...current, ...patch }));

    if ("category" in patch) {
      const category = String(patch.category || "").trim();
      if (category) {
        setTicketCategoryPromptOpen(false);
        setSubmitTicketError("");
        if (voiceStepRef.current === "confirm") {
          setVoiceFeedback("Categorie choisie. Dis maintenant valider, modifier ou annuler.");
        }
      }
    }
  };

  const handleSubmitTicket = async (
    formOverride?: NewTicketForm,
    options?: { viaVoice?: boolean }
  ) => {
    const sourceForm = formOverride ?? newTicketFormRef.current;
    const normalizedForm: NewTicketForm = {
      ...sourceForm,
      date: (sourceForm.date || "").trim(),
      amount: (sourceForm.amount || "").trim(),
      description: (sourceForm.description || "").trim(),
      category: (sourceForm.category || inferCategoryFromDescription(sourceForm.description || "") || "").trim(),
    };

    if (!normalizedForm.date || !normalizedForm.amount || !normalizedForm.description) {
      setSubmitTicketError("Date, montant et description sont obligatoires.");
      return;
    }

    if (!normalizedForm.category) {
      promptManualTicketCategory(Boolean(options?.viaVoice));
      return;
    }

    try {
      setSubmittingTicket(true);
      setSubmitTicketError("");
      setTicketCategoryPromptOpen(false);
      setVoiceFeedback("");
      stopTicketVoiceSession();

      const response = await createTicketInSheets(selectedMonth, normalizedForm);
      const responseObject = response as { success?: boolean; error?: string };

      if (responseObject?.success === false) {
        throw new Error(responseObject.error || "Ajout du ticket refuse par Google Sheets.");
      }

      setReloadSeed((value) => value + 1);
      setTicketFollowUpPrompt({
        keepDate: normalizedForm.date,
        voiceEnabled: Boolean(options?.viaVoice),
      });
      setVoiceTranscript("");
      if (options?.viaVoice) {
        window.setTimeout(() => {
          startTicketVoiceSession(getAnotherTicketVoicePrompt());
        }, 180);
      }
    } catch (error) {
      setSubmitTicketError(getErrorMessage(error));
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handleStartEditTicket = (ticket: Ticket) => {
    const dateParts = (ticket.date || "").split("/");
    const isoDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : "";
    setEditingTicket(ticket);
    setEditTicketForm({
      date: isoDate,
      description: ticket.description,
      category: ticket.category,
      amount: String(ticket.amount),
    });
    setEditTicketError("");
  };

  const handleCancelEditTicket = () => {
    setEditingTicket(null);
    setEditTicketForm({ date: "", description: "", category: "", amount: "" });
    setEditTicketError("");
  };

  const handleSaveEditTicket = async () => {
    if (!editingTicket) return;
    if (!editTicketForm.date || !editTicketForm.amount || !editTicketForm.description.trim()) {
      setEditTicketError("Date, montant et description sont obligatoires.");
      return;
    }
    if (!Number.isFinite(editingTicket.sheetRow) || !Number.isFinite(editingTicket.blockIndex)) {
      setEditTicketError("Impossible de localiser ce ticket dans le sheet.");
      return;
    }

    try {
      setEditTicketSaving(true);
      setEditTicketError("");

      const response = await updateTicketInSheets(
        selectedMonth,
        editingTicket.sheetRow!,
        editingTicket.blockIndex!,
        editTicketForm
      );
      const responseObject = response as { success?: boolean; error?: string };

      if (responseObject?.success === false) {
        throw new Error(responseObject.error || "Modification refusee par Google Sheets.");
      }

      const changes: string[] = [];
      if (editTicketForm.description !== editingTicket.description)
        changes.push(`Description : "${editingTicket.description || "—"}" → "${editTicketForm.description}"`);
      if (editTicketForm.date !== editingTicket.date)
        changes.push(`Date : ${editingTicket.date || "—"} → ${editTicketForm.date}`);
      if (Number(editTicketForm.amount) !== editingTicket.amount)
        changes.push(`Montant : ${euro.format(editingTicket.amount)} → ${euro.format(Number(editTicketForm.amount))}`);
      if ((editTicketForm.category || "") !== (editingTicket.category || ""))
        changes.push(`Categorie : ${editingTicket.category || "—"} → ${editTicketForm.category || "—"}`);

      pushHistoryEvent({
        tone: "ok",
        source: "sheet",
        title: "Ticket modifie",
        detail: changes.length > 0
          ? changes.join(" • ")
          : `"${editTicketForm.description}" — ${euro.format(Number(editTicketForm.amount))}`,
        shortcut: null,
      });

      setEditingTicket(null);
      setEditTicketForm({ date: "", description: "", category: "", amount: "" });
      setReloadSeed((value) => value + 1);
    } catch (error) {
      setEditTicketError(getErrorMessage(error));
    } finally {
      setEditTicketSaving(false);
    }
  };

  const handleSubmitReimbursements = async () => {
    if (!reimbursementForm.category.trim() || !reimbursementForm.amount.trim()) {
      setReimbursementError("Choisis un type et indique un montant.");
      return;
    }

    try {
      setSubmittingReimbursements(true);
      setReimbursementStatus("");
      setReimbursementError("");

      const response = await createReimbursementsInSheets(selectedMonth, [reimbursementForm]);
      const responseObject = response as {
        success?: boolean;
        error?: string;
        result?: { count?: number };
      };

      if (responseObject?.success === false) {
        throw new Error(responseObject.error || "Ajout des remboursements refuse par Google Sheets.");
      }

      const count = Number(responseObject?.result?.count || 1);
      setReimbursementForm(createEmptyReimbursementLine());
      setReimbursementStatus(
        `${count} remboursement(s) ajoute(s) dans ${getSelectedMonthLabel(selectedMonth)}.`
      );
      setReloadSeed((value) => value + 1);
    } catch (error) {
      setReimbursementError(getErrorMessage(error));
    } finally {
      setSubmittingReimbursements(false);
    }
  };

  const handleDeleteReimbursement = async (row: number) => {
    const entryToDelete = reimbursementDetails.entries.find((entry) => entry.row === row);

    if (!entryToDelete) {
      setReimbursementError("Remboursement introuvable dans le detail actuel.");
      return;
    }

    try {
      setDeletingReimbursementRow(row);
      setReimbursementStatus("");
      setReimbursementError("");

      const response = await deleteReimbursementInSheets(selectedMonth, row);
      const responseObject = response as { success?: boolean; error?: string };

      if (responseObject?.success === false) {
        throw new Error(
          responseObject.error || "Suppression du remboursement refusee par Google Sheets."
        );
      }

      reimbursementUndoActionRef.current = {
        kind: "delete",
        month: selectedMonth,
        entry: entryToDelete,
      };
      reimbursementRedoActionRef.current = null;

      setReimbursementStatus(`Remboursement H${row} / I${row} supprime.`);
      pushHistoryEvent({
        tone: "ok",
        source: "sheet",
        shortcut: null,
        title: "Remboursement supprime",
        detail: `${entryToDelete.category} • ${euro.format(entryToDelete.amount)} • H${row} / I${row} • ${getSelectedMonthLabel(selectedMonth)}`,
      });
      onReloadDoneRef.current = () => setDeletingReimbursementRow(null);
      setReloadSeed((value) => value + 1);
    } catch (error) {
      setReimbursementError(getErrorMessage(error));
      setDeletingReimbursementRow(null);
    }
  };

  const handleSignIn = async () => {
    const email = normalizeEmail(signInForm.email);
    const password = signInForm.password;

    if (!email || !password) {
      setAuthError("Email et mot de passe obligatoires.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthStatus("");

      const account = await signInAccountInSheets(email, password);
      persistSessionAccount(account);
      setCurrentAccount(account);
      setSignInForm((current) => ({ ...current, password: "" }));
      setAuthStatus(`Connexion reussie. Bonjour ${account.firstName || account.email}.`);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async () => {
    const email = normalizeEmail(signUpForm.email);
    const firstName = signUpForm.firstName.trim();
    const lastName = signUpForm.lastName.trim();
    const pseudo = signUpForm.pseudo.trim();
    const password = signUpForm.password;
    const confirmPassword = signUpForm.confirmPassword;

    if (!firstName || !lastName || !email || !password) {
      setAuthError("Prenom, nom, email et mot de passe sont obligatoires.");
      return;
    }

    if (!pseudo) {
      setAuthError("Le pseudo est obligatoire.");
      return;
    }

    if (password.length < 6) {
      setAuthError("Le mot de passe doit faire au moins 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setAuthError("La confirmation du mot de passe ne correspond pas.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthStatus("");

      const account = await signUpAccountInSheets(signUpForm);
      persistSessionAccount(account);
      setCurrentAccount(account);
      setAuthMode("signin");
      setSignInForm({ email: account.email, password: "" });
      setSignUpForm({
        firstName: "",
        lastName: "",
        pseudo: "",
        email: "",
        password: "",
        confirmPassword: "",
        cursorColor: account.cursorColor,
      });
      setAuthStatus(`Compte cree pour ${getAccountDisplayName(account)}.`);
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    persistSessionAccount(null);
    setCurrentAccount(null);
    setLocalCollaborators([]);
    setRemoteCollaborators([]);
    setCollabFeed([]);
    setCollabSignals([]);
    setFollowedPeerId("");
    setCollabConnectionState("connecting");
    knownPeerIdsRef.current.clear();
    setAuthMode("signin");
    setAuthError("");
    setAuthStatus("");
    setSignInForm((current) => ({ ...current, email: currentAccount?.email || current.email, password: "" }));
    setPage("dashboard");
  };

  const handleLoadAdminUsers = async () => {
    if (!currentAccount || !isPrivileged(currentAccount)) return;
    setAdminLoading(true);
    setAdminError("");
    try {
      const users = await fetchAllUsersFromSheets(currentAccount.email, currentAccount.sessionToken);
      const usersWithFounder = users.map((u) => u.email === FOUNDER_EMAIL ? { ...u, role: "founder" as const } : u);
      console.log("ADMIN USERS RAW:", users);
      console.log("ADMIN USERS NORMALIZED:", usersWithFounder);
      setAdminUsers(usersWithFounder);
    } catch (err) {
      setAdminError(getErrorMessage(err));
    } finally {
      setAdminLoading(false);
    }
  };

  const handleToggleUserRole = async (targetEmail: string, newRole: "admin" | "user") => {
    if (!currentAccount || currentAccount.role !== "founder") return;
    if (targetEmail === FOUNDER_EMAIL) return;
    setAdminLoading(true);
    setAdminError("");
    try {
      await updateUserRoleInSheets(
        currentAccount.email,
        currentAccount.sessionToken,
        targetEmail,
        newRole
      );
      await handleLoadAdminUsers();

      void supabaseChannelRef.current?.send({
        type: "broadcast",
        event: "role-update",
        payload: { targetEmail, newRole },
      });
    } catch (err) {
      setAdminError(getErrorMessage(err));
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (!currentAccount) return;
    if (page !== "admin") return;
    if (!isPrivileged(currentAccount)) return;

    void handleLoadAdminUsers();
  }, [page, currentAccount?.email, currentAccount?.sessionToken]);

  const handleSaveQuickProfile = async () => {
    if (!currentAccount) return;

    try {
      setAccountSettingsLoading(true);
      setAccountSettingsError("");
      setAccountSettingsStatus("");

      const updatedAccount = await updateQuickProfileInSheets(
        currentAccount,
        accountSettingsForm.pseudo,
        accountSettingsForm.cursorColor
      );
      persistSessionAccount(updatedAccount);
      setCurrentAccount(updatedAccount);
      setAccountSettingsStatus("Pseudo et couleur mis a jour.");
    } catch (error) {
      setAccountSettingsError(getErrorMessage(error));
    } finally {
      setAccountSettingsLoading(false);
    }
  };

  const handleSaveAccountSettings = async () => {
    if (!currentAccount) {
      return;
    }

    const nextEmail = normalizeEmail(accountSettingsForm.email);
    const nextFirstName = accountSettingsForm.firstName.trim();
    const nextLastName = accountSettingsForm.lastName.trim();
    const currentPassword = accountSettingsForm.currentPassword;
    const newPassword = accountSettingsForm.newPassword;
    const confirmPassword = accountSettingsForm.confirmPassword;

    if (!nextFirstName || !nextLastName || !nextEmail) {
      setAccountSettingsError("Prenom, nom et email sont obligatoires.");
      return;
    }

    if (!currentPassword) {
      setAccountSettingsError("Le mot de passe actuel est obligatoire pour modifier le compte.");
      return;
    }

    if ((newPassword || confirmPassword) && newPassword.length < 6) {
      setAccountSettingsError("Le nouveau mot de passe doit faire au moins 6 caracteres.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setAccountSettingsError("La confirmation du nouveau mot de passe ne correspond pas.");
      return;
    }

    try {
      setAccountSettingsLoading(true);
      setAccountSettingsError("");
      setAccountSettingsStatus("");

      const updatedAccount = await updateRemoteAccountInSheets(currentAccount, accountSettingsForm);
      persistSessionAccount(updatedAccount);
      setCurrentAccount(updatedAccount);
      setSignInForm((current) => ({ ...current, email: updatedAccount.email }));
      setAccountSettingsStatus("Compte mis a jour.");
    } catch (error) {
      setAccountSettingsError(getErrorMessage(error));
    } finally {
      setAccountSettingsLoading(false);
    }
  };

  const runUpdaterCheck = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!isTauriRuntime) {
      if (!silent) {
        setUpdaterError("La verification des mises a jour est disponible dans l app desktop Tauri.");
      }
      return null;
    }

    try {
      setCheckingUpdates(true);

      if (!silent) {
        setUpdaterError("");
        setUpdaterMessage("");
      }

      const status = await invoke<UpdaterStatus>("get_updater_status");
      setUpdaterStatus(status);

      if (!status.configured) {
        setAvailableUpdate(null);

        if (!silent) {
          setUpdaterMessage("La partie updater est prete, mais il faut encore configurer la release distante.");
        }

        return null;
      }

      const update = await invoke<AvailableUpdate | null>("fetch_app_update");
      setAvailableUpdate(update);

      if (!silent) {
        if (update) {
          setUpdaterMessage(`Version ${update.version} disponible.`);
        } else {
          setUpdaterMessage("Tu es deja sur la derniere version.");
        }
      }

      return update;
    } catch (error) {
      if (!silent) {
        setUpdaterError(getErrorMessage(error));
      }
      return null;
    } finally {
      setCheckingUpdates(false);
    }
  };

  useEffect(() => {
    if (!currentAccount || !isTauriRuntime || startupUpdaterCheckedRef.current) {
      return;
    }

    startupUpdaterCheckedRef.current = true;
    void runUpdaterCheck({ silent: true });

    const pollInterval = setInterval(() => {
      void runUpdaterCheck({ silent: true });
    }, 5 * 60 * 1000);

    return () => clearInterval(pollInterval);
  }, [currentAccount, isTauriRuntime]);

  const handleCheckUpdates = async () => {
    if (!isTauriRuntime) {
      setUpdaterError("La verification des mises a jour est disponible dans l app desktop Tauri.");
      return;
    }

    await runUpdaterCheck();
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate) {
      setUpdaterError("Aucune mise a jour disponible pour le moment.");
      return;
    }

    try {
      setInstallingUpdate(true);
      setUpdaterError("");
      setUpdaterMessage("");

      await invoke("install_app_update");
      setUpdaterMessage(
        "Mise a jour telechargee et installee. Sur Windows, l app peut se fermer pour terminer l installation."
      );
      setAvailableUpdate(null);
    } catch (error) {
      setUpdaterError(getErrorMessage(error));
    } finally {
      setInstallingUpdate(false);
    }
  };

  const startTicketVoiceSession = (initialFeedback?: string) => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSubmitTicketError("La dicter vocale n est pas disponible ici.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const chunk = result[0].transcript.trim();

        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${chunk}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${chunk}`.trim();
        }
      }

      setVoiceTranscript(interimTranscript || finalTranscript);

      if (finalTranscript) {
        handleVoiceResult(finalTranscript);
      }
    };

    recognition.onerror = () => {
      shouldRestartRecognitionRef.current = false;
      setVoiceListening(false);
      setVoiceFeedback("La dicter vocale a rencontre un probleme.");
    };

    recognition.onend = () => {
      if (shouldRestartRecognitionRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          setVoiceListening(false);
        }
      }

      setVoiceListening(false);
    };

    recognitionRef.current = recognition;
    shouldRestartRecognitionRef.current = true;
    setSubmitTicketError("");
    setVoiceListening(true);
    setVoiceFeedback(
      initialFeedback ??
        (ticketFollowUpPromptRef.current
          ? getAnotherTicketVoicePrompt()
          : getVoiceStepPrompt(voiceStepRef.current, newTicketFormRef.current))
    );

    try {
      recognition.start();
    } catch {
      shouldRestartRecognitionRef.current = false;
      setVoiceListening(false);
      setVoiceFeedback("Impossible de lancer la dicter pour le moment.");
    }
  };

  const handleAnotherTicketChoice = (wantsAnotherTicket: boolean) => {
    const followUpPrompt = ticketFollowUpPromptRef.current;

    if (!wantsAnotherTicket) {
      handleCloseTicketModal();
      return;
    }

    const nextForm: NewTicketForm = {
      date: followUpPrompt?.keepDate || new Date().toISOString().slice(0, 10),
      amount: "",
      description: "",
      category: "",
    };

    setTicketFollowUpPrompt(null);
    setTicketCategoryPromptOpen(false);
    setSubmitTicketError("");
    setVoiceTranscript("");
    setVoiceStep("date");
    updateNewTicketForm(nextForm);
    stopTicketVoiceSession();

    if (followUpPrompt?.voiceEnabled) {
      setVoiceFeedback(getVoiceStepPrompt("date", nextForm));
      window.setTimeout(() => {
        startTicketVoiceSession(getVoiceStepPrompt("date", nextForm));
      }, 180);
      return;
    }

    setVoiceFeedback("");
  };

  const handleVoiceResult = (transcript: string) => {
    const normalizedCommand = normalizeVoiceCommand(transcript);
    const currentStep = voiceStepRef.current;
    const currentForm = newTicketFormRef.current;
    const followUpPrompt = ticketFollowUpPromptRef.current;

    if (followUpPrompt) {
      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.yes)) {
        handleAnotherTicketChoice(true);
        return;
      }

      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.no)) {
        handleAnotherTicketChoice(false);
        return;
      }

      setVoiceFeedback("Je n ai pas compris. Dis oui ou non.");
      return;
    }

    if (currentStep === "confirm") {
      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.cancel)) {
        handleCloseTicketModal();
        return;
      }

      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.restart)) {
        setTicketCategoryPromptOpen(false);
        updateNewTicketForm((current) => ({
          ...current,
          amount: "",
          description: "",
          category: "",
        }));
        setVoiceTranscript("");
        setVoiceFeedback("On repart proprement. Redis la date.");
        setVoiceStep("date");
        return;
      }

      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.edit)) {
        setVoiceTranscript("");
        setVoiceFeedback("Mode modification. Redis la date, puis le montant, puis la description.");
        setVoiceStep("date");
        return;
      }

      if (hasVoiceKeyword(normalizedCommand, voiceCommandKeywords.confirm)) {
        void handleSubmitTicket(currentForm, { viaVoice: true });
        return;
      }

      const detectedCategory = detectVoiceCategory(transcript);
      if (detectedCategory) {
        handleNewTicketFormChange({ category: detectedCategory });
        return;
      }

      setVoiceFeedback(
        currentForm.category
          ? "Dis valider, modifier ou annuler."
          : "Choisis une categorie puis dis valider, modifier ou annuler."
      );
      return;
    }

    const patch = applyVoiceStepValue(currentStep, transcript, currentForm);

    if (
      (currentStep === "date" && !patch.date) ||
      (currentStep === "amount" && !patch.amount) ||
      (currentStep === "description" && !patch.description)
    ) {
      setVoiceFeedback(`Je n ai pas bien compris la ${getVoiceStepLabel(currentStep).toLowerCase()}. Redis calmement.`);
      return;
    }

    handleNewTicketFormChange(patch);
    setVoiceTranscript(transcript);

    const nextStep = getNextVoiceStep(currentStep);
    setVoiceStep(nextStep);

    if (currentStep === "date") {
      setVoiceFeedback("Date comprise. Dis maintenant le montant.");
      return;
    }

    if (currentStep === "amount") {
      setVoiceFeedback("Montant compris. Dis maintenant la description.");
      return;
    }

    const nextCategory = String(patch.category || currentForm.category || "").trim();
    if (!nextCategory) {
      promptManualTicketCategory(true);
      setVoiceFeedback("Description comprise. Je n ai pas trouve la categorie. Choisis-la dans le menu deroulant puis dis valider.");
      return;
    }

    setVoiceFeedback(`Description comprise. Categorie detectee: ${nextCategory}. Dis valider, modifier ou annuler.`);
  };

  const handleToggleVoice = () => {
    if (voiceListening && recognitionRef.current) {
      stopTicketVoiceSession();
      setVoiceFeedback("Dictée arrêtée.");
      return;
    }

    if (ticketFollowUpPromptRef.current && !ticketFollowUpPromptRef.current.voiceEnabled) {
      setTicketFollowUpPrompt({
        ...ticketFollowUpPromptRef.current,
        voiceEnabled: true,
      });
    }

    startTicketVoiceSession();
  };

  const handleCollabNameChange = (value: string) => {
    const trimmed = value.trimStart();
    setCollabIdentity((current) => {
      const next = {
        ...current,
        name: trimmed || current.name,
      };
      persistCollabIdentity(next);
      return next;
    });
  };

  const handleSharedNoteChange = (value: string) => {
    setSharedNote(value);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(collabSharedNoteStorageKey, value);
    }

    collabNoteTimestampRef.current = Date.now();
    collabChannelRef.current?.postMessage({
      type: "note",
      user: collabIdentity,
      note: value,
      timestamp: collabNoteTimestampRef.current,
    } satisfies CollabMessage);

    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "note",
      payload: {
        id: collabIdentityRef.current.id,
        seed: collabIdentityRef.current.seed,
        name: collabIdentityRef.current.name,
        color: collabIdentityRef.current.color,
        note: value,
        timestamp: collabNoteTimestampRef.current,
      },
    });

    pushSupabasePresenceRef.current?.("heartbeat");
  };

  const handleClearSharedNote = () => {
    if (!sharedNote) {
      return;
    }

    pushHistorySnapshot();
    handleSharedNoteChange("");

    pushCollabFeed(
      `note-clear:${Date.now()}`,
      `${collabIdentityRef.current.name} a vide le bloc-note partage.`,
      "warn",
      collabIdentityRef.current.color
    );
  };

  const broadcastTicketFocus = (focusTicketKey: string, focusTicketLabel: string) => {
    collabFocusRef.current = { key: focusTicketKey, label: focusTicketLabel };
    collabChannelRef.current?.postMessage({
      type: "focus",
      user: collabIdentity,
      page: "tickets",
      focusTicketKey,
      focusTicketLabel,
      timestamp: Date.now(),
    } satisfies CollabMessage);

    pushSupabasePresenceRef.current?.("focus");
  };

  const handleSendCollabSignal = (kind: CollabSignalKind) => {
    const signalId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${collabIdentityRef.current.id}-${Date.now()}`;
    const pointer = collabPointerStateRef.current;
    const x = pointer.visible ? pointer.x : 68;
    const y = pointer.visible ? pointer.y : 28;
    const timestamp = Date.now();

    pushSignal(
      signalId,
      kind,
      collabIdentityRef.current.name,
      collabIdentityRef.current.color,
      x,
      y,
      timestamp
    );

    collabChannelRef.current?.postMessage({
      type: "signal",
      user: collabIdentity,
      signalId,
      kind,
      x,
      y,
      timestamp,
    } satisfies CollabMessage);

    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: {
        signalId,
        kind,
        name: collabIdentityRef.current.name,
        color: collabIdentityRef.current.color,
        x,
        y,
        timestamp,
      },
    });
  };

  const handleTicketHover = (ticket: Ticket) => {
    setBudgetPreviewTicket(ticket);
    broadcastTicketFocus(
      getTicketKey(ticket),
      `${ticket.description || "Sans description"} • ${ticket.date || "Sans date"}`
    );
  };

  const handleTicketLeave = () => {
    setBudgetPreviewTicket(null);
    broadcastTicketFocus("", "");
  };

  const handleOpenSecondSession = async () => {
    setCollabError("");
    setCollabStatus("");

    const instanceSeed =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : `clone-${Date.now()}`;

    const targetUrl = getCollabUrl("collab", instanceSeed);
    const isTauriRuntime =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    if (!isTauriRuntime) {
      const popup = window.open(
        targetUrl,
        "_blank",
        "noopener,noreferrer,width=1280,height=860"
      );

      if (!popup) {
        setCollabError("Le navigateur a bloque l ouverture de la seconde session.");
        return;
      }

      setCollabStatus("Session 2 ouverte dans une nouvelle fenetre.");
      return;
    }0

    try {
      const label = `collab-${instanceSeed}`;
      const windowRef = new WebviewWindow(label, {
        title: `Budget PC - Session ${instanceSeed.toUpperCase()}`,
        url: targetUrl,
        width: 1280,
        height: 860,
      });

      windowRef.once("tauri://created", () => {
        setCollabStatus("Session 2 ouverte dans une nouvelle fenetre desktop.");
      });

      windowRef.once("tauri://error", (error) => {
        setCollabError(
          typeof error.payload === "string"
            ? error.payload
            : "La seconde fenetre n a pas pu etre creee."
        );
      });
    } catch (error) {
      setCollabError(getErrorMessage(error));
    }
  };

  const broadcastPointer = (x: number, y: number, visible: boolean, scrollY = 0) => {
    collabPointerStateRef.current = { x, y, visible, scrollY };

    collabChannelRef.current?.postMessage({
      type: "pointer",
      user: collabIdentity,
      page: pageRef.current,
      x,
      y,
      scrollY,
      insideBoard: visible,
      timestamp: Date.now(),
    } satisfies CollabMessage);

    void supabaseChannelRef.current?.send({
      type: "broadcast",
      event: "pointer",
      payload: {
        id: collabIdentityRef.current.id,
        seed: collabIdentityRef.current.seed,
        name: collabIdentityRef.current.name,
        color: collabIdentityRef.current.color,
        page: pageRef.current,
        context: getPresenceContext(pageRef.current, selectedMonthRef.current),
        cursorX: x,
        cursorY: y,
        scrollY,
        insideBoard: visible,
        lastSeen: Date.now(),
        focusTicketKey: collabFocusRef.current.key,
        focusTicketLabel: collabFocusRef.current.label,
      },
    });

    if (!visible) {
      pushSupabasePresenceRef.current?.("heartbeat");
    }
  };

    const handleCollabBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      const now = Date.now();

      if (now - lastPointerSentAtRef.current < 24) {
        return;
      }

      lastPointerSentAtRef.current = now;
      broadcastPointer(x, y, true, 0);
    };

    const handleCollabBoardPointerLeave = () => {
      broadcastPointer(50, 50, false, 0);
    };

    const handleGlobalPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (pageRef.current === "collab") {
      return;
    }

    const mainRect = mainElRef.current?.getBoundingClientRect();
    if (!mainRect || mainRect.width === 0 || mainRect.height === 0) {
      return;
    }

    const x = Math.max(0, Math.min(100, ((event.clientX - mainRect.left) / mainRect.width) * 100));
    const scrollH = mainElRef.current?.scrollHeight ?? mainRect.height;
    const absY = event.clientY - mainRect.top + mainScrollYRef.current;
    const y = Math.max(0, Math.min(100, (absY / scrollH) * 100));
    const now = Date.now();

    if (now - lastPointerSentAtRef.current < 24) {
      return;
    }

    lastPointerSentAtRef.current = now;
    broadcastPointer(x, y, true, 0);
  };

  const handleGlobalPointerLeave = () => {
    broadcastPointer(50, 50, false);
  };


  if (!currentAccount) {
    return renderAuthScreen(
      authMode,
      signInForm,
      signUpForm,
      authLoading,
      authStatus,
      authError,
      (mode) => {
        setAuthMode(mode);
        setAuthError("");
      },
      (patch) => {
        setSignInForm((current) => ({ ...current, ...patch }));
        setAuthError("");
      },
      (patch) => {
        setSignUpForm((current) => ({ ...current, ...patch }));
        setAuthError("");
      },
      handleSignIn,
      handleSignUp
    );
  }

  const hasCurrentPageAccess = canAccessPage(currentAccount, page);
  const currentMeta = pageMeta[hasCurrentPageAccess ? page : getFirstAccessiblePage(currentAccount)];

  const menuItems: { key: PageKey; label: string; badge?: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "tickets", label: "Tickets", badge: String(tickets.length) },
    { key: "annual", label: "Envoi annuel" },
    { key: "audits", label: "Audits" },
    { key: "compare", label: "Comparateur" },
    { key: "subscriptions", label: "Abonnements", badge: "6" },
    { key: "collab", label: "Collab", badge: String(collaborators.length + 1) },
    { key: "settings", label: "Parametres" },
    { key: "version", label: "Version" },
    { key: "admin" as PageKey, label: "Admin" },
  ];
  const menu = menuItems;
  const mainViewportRect = mainElRef.current?.getBoundingClientRect() ?? null;

  const deniedAccessModal =
    deniedPageModal && typeof document !== "undefined"
      ? createPortal(
          <div className="modal-backdrop access-denied-backdrop" onClick={() => setDeniedPageModal(null)}>
            <div className="access-denied-modal" onClick={(event) => event.stopPropagation()}>
              <div className="access-denied-orb">🔒</div>
              <span className="panel-kicker">Acces non autorise</span>
              <h2>{pageMeta[deniedPageModal].title}</h2>
              <p>
                Tu vois ce module dans le menu, mais ton compte n a pas encore
                l autorisation necessaire pour ouvrir cet onglet.
              </p>
              <div className="access-denied-hint">
                Demande a un admin de t activer l acces dans le panneau Admin.
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={() => setDeniedPageModal(null)}
              >
                Compris
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  const renderHistoryEventRow = (eventItem: HistoryEvent) => {
    const eventDate = new Date(eventItem.createdAt);
    const dateLabel = eventDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
    const timeLabel = eventDate.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return (
      <div key={eventItem.id} className={`history-log-row ${eventItem.tone}`}>
        <div className="history-log-time">
          <span>{dateLabel}</span>
          <strong>{timeLabel}</strong>
        </div>
        <div className="history-log-main">
          <div className="history-log-head">
            <div className="history-log-title-wrap">
              {eventItem.author ? (
                <span className="history-log-author">{eventItem.author}</span>
              ) : null}
              {eventItem.shortcut ? (
                <span className="history-log-shortcut">{eventItem.shortcut}</span>
              ) : null}
              <strong>{eventItem.title}</strong>
            </div>
            <button
              type="button"
              className="history-log-delete"
              onClick={() => handleDeleteHistoryEvent(eventItem.id)}
              title="Supprimer cette notification"
            >
              Supprimer
            </button>
          </div>
          <p>{eventItem.detail}</p>
        </div>
      </div>
    );
  };

  const historyModal =
    historyPanelOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="modal-backdrop history-backdrop"
            onClick={() => setHistoryPanelOpen(false)}
          >
            <div
              className="budget-modal history-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="budget-modal-head">
                <div>
                  <span className="eyebrow">Historique</span>
                  <h2>Actions appliquees</h2>
                  <p>
                    Date, heure, raccourci, action et resultat. Cet historique reste
                    ici jusqu a suppression manuelle sur ce compte.
                  </p>
                </div>

                <div className="history-modal-actions">
                  <button
                    type="button"
                    className="ghost-btn history-clear-btn"
                    onClick={handleClearHistoryEvents}
                    disabled={historyEvents.length === 0}
                  >
                    Effacer tout
                  </button>
                  <button
                    type="button"
                    className="modal-close"
                    onClick={() => setHistoryPanelOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
              </div>

              <div className="history-log-columns">
                {(() => {
                  const appEvents = historyEvents.filter((e) => e.source === "app");
                  const sheetEvents = historyEvents.filter((e) => e.source === "sheet");
                  return (
                    <>
                      <div className="history-log-col">
                        <div className="history-log-section-label history-log-section-sheet">Google Sheets</div>
                        {sheetEvents.length > 0 ? (
                          <div className="history-log-list">
                            {sheetEvents.map(renderHistoryEventRow)}
                          </div>
                        ) : (
                          <div className="history-log-empty-col">Aucune action Google Sheets.</div>
                        )}
                      </div>

                      <div className="history-log-col">
                        <div className="history-log-section-label history-log-section-app">App</div>
                        {appEvents.length > 0 ? (
                          <div className="history-log-list">
                            {appEvents.map(renderHistoryEventRow)}
                          </div>
                        ) : (
                          <div className="history-log-empty-col">Aucune action locale.</div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className="app-shell"
      onPointerMove={handleGlobalPointerMove}
      onPointerLeave={handleGlobalPointerLeave}
    >
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="brand">
            <div className="brand-logo">
              <img src="/budget-pc-logo.svg" alt="Budget PC" className="brand-logo-image" />
            </div>
            <div>
              <div className="brand-title">Budget PC</div>
              <div className="brand-sub">Jeanseb edition</div>
            </div>
          </div>

          <div className="sidebar-section">
            <span className="section-label">Navigation</span>
            <nav className="nav">
              {menu.map((item) => {
                const peersOnPage = collaborators.filter((p) => p.page === item.key);
                const isAllowed = canAccessPage(currentAccount, item.key);
                return (
                  <button
                    key={item.key}
                    className={`nav-item ${page === item.key ? "active" : ""} ${!isAllowed ? "locked" : ""}`}
                    onClick={() => changePageWithHistory(item.key)}
                  >
                    <span className="nav-item-top">
                      <span>{item.label}</span>
                      {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                    </span>
                    {!isAllowed ? <span className="nav-locked-label">Bloque</span> : null}
                    {peersOnPage.length > 0 ? (
                      <span className="nav-peers">
                        {peersOnPage.slice(0, 3).map((peer) => (
                          <span
                            key={peer.id}
                            className="nav-peer-bubble"
                            style={{ backgroundColor: peer.color + "22", borderColor: peer.color, color: peer.color }}
                          >
                            {peer.name}
                          </span>
                        ))}
                        {peersOnPage.length > 3 ? (
                          <span className="nav-peer-overflow">+{peersOnPage.length - 3}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="sidebar-card">
            <span className="section-label">Statut</span>
            <strong>{currentMeta.title}</strong>
            <p>{currentMeta.subtitle}</p>
            <div className="sidebar-account">
              <span className="collab-dot" style={{ backgroundColor: currentAccount.cursorColor }} />
              <div>
                <strong>{getAccountDisplayName(currentAccount)}</strong>
                <p>{currentAccount.email}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main
        className="main"
        ref={mainElRef}
        onScroll={(e) => {
          const nextScrollTop = (e.target as HTMLElement).scrollTop;
          mainScrollYRef.current = nextScrollTop;
          setMainScrollY(nextScrollTop);
        }}
      >

        {(() => {
          const onlinePeers = collaborators.filter(
            (p) => Date.now() - p.lastSeen < collabPresenceTimeoutMs
          );
          const onlineCount = onlinePeers.length + 1;
          return (
            <div className="online-badge-wrapper">
              {refreshingTickets ? <span className="sync-badge">Synchro...</span> : null}
              <button
                className="online-badge"
                onClick={() => setShowOnlinePopup((v) => !v)}
                title={`${onlineCount} en ligne`}
              >
                <span className="online-badge-dot" />
                <span className="online-badge-count">{onlineCount}</span>
              </button>
              {showOnlinePopup && (
                <div className="online-popup">
                  <div className="online-popup-title">En ligne ({onlineCount})</div>
                  <ul className="online-popup-list">
                    <li className="online-popup-item">
                      <span className="online-popup-dot" style={{ background: currentAccount.cursorColor }} />
                      <span className="online-popup-name">{getAccountDisplayName(currentAccount)}</span>
                      <span className="online-popup-you">vous</span>
                    </li>
                    {onlinePeers.map((peer) => (
                      <li key={peer.id} className="online-popup-item">
                        <span className="online-popup-dot" style={{ background: peer.color }} />
                        <span className="online-popup-name">{peer.name || "Anonyme"}</span>
                        <span className="online-popup-page">{peer.page}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        <div className="history-toolbar">
          <div className="history-toolbar-actions">
            <button
              type="button"
              className="ghost-btn history-btn"
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label="Retour en arriere"
              title="Retour en arriere (Ctrl+Z)"
            >
              <svg className="history-btn-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>

            <button
              type="button"
              className="ghost-btn history-btn"
              onClick={handleRedo}
              disabled={!canRedo}
              aria-label="Retour en avant"
              title="Retour en avant (Ctrl+Y)"
            >
              <svg className="history-btn-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button
              type="button"
              className="ghost-btn history-log-btn"
              onClick={() => setHistoryPanelOpen(true)}
              title="Historique des actions appliquees"
            >
              Historique
            </button>

            {sharedCsvImportSession ? (
              <button
                type="button"
                className={`ghost-btn history-import-btn ${sharedCsvImportSession.submittingById ? "is-live" : "is-open"}`}
                onClick={handleOpenSharedCsvImportSession}
                title="Rejoindre l import CSV partage"
              >
                <span
                  className="history-import-pulse"
                  style={{
                    backgroundColor:
                      sharedCsvImportSession.submittingById
                        ? sharedCsvImportSession.ownerColor
                        : sharedCsvImportSession.ownerColor,
                  }}
                />
                <span className="history-import-copy">
                  <strong>
                    {sharedCsvImportSession.submittingByName || sharedCsvImportSession.ownerName}
                  </strong>
                  <span>
                    {sharedCsvImportSession.submittingById
                      ? "importe des tickets"
                      : "prepare un import CSV"}
                  </span>
                </span>
                <span className="history-import-count">
                  {sharedCsvImportSession.participants.length}
                </span>
              </button>
            ) : null}
          </div>
        </div>
  
        <div className="global-cursor-layer">
          {visibleRemoteCursors.map((peer) => {
            if (!mainViewportRect) {
              return null;
            }

            const scrollH = mainElRef.current?.scrollHeight ?? mainViewportRect.height;
            const absY = (peer.cursorY / 100) * scrollH;
            const topPx = mainViewportRect.top + absY - mainScrollY;
            const leftPx = mainViewportRect.left + (peer.cursorX / 100) * mainViewportRect.width;

            return (
              <div
                className="remote-cursor global"
                key={`global-${peer.id}`}
                style={{
                  left: `${leftPx}px`,
                  top: `${topPx}px`,
                }}
              >
                <div className="remote-cursor-pin" style={{ backgroundColor: peer.color }} />
                <div className="remote-cursor-tag" style={{ borderColor: peer.color }}>
                  <span className="collab-dot" style={{ backgroundColor: peer.color }} />
                  <strong>{peer.name}</strong>
                </div>
              </div>
            );
          })}
        </div>
        {updateAvailable && availableUpdate ? (
          <div className="update-blocker-overlay">
            <div className="update-blocker-card">
              <div className="update-blocker-badge">MAJ DISPO</div>
              <h1 className="update-blocker-title">Mise a jour requise</h1>
              <p className="update-blocker-subtitle">
                Une nouvelle version de Budget PC est disponible. Veuillez mettre a jour pour continuer.
              </p>

              <div className="update-blocker-version-row">
                <span className="update-blocker-version-old">v{availableUpdate.currentVersion}</span>
                <span className="update-blocker-arrow">→</span>
                <span className="update-blocker-version-new">v{availableUpdate.version}</span>
              </div>

              {updateBannerDateLabel ? (
                <span className="update-blocker-date">Publiee le {updateBannerDateLabel}</span>
              ) : null}

              {availableUpdate.notes ? (
                <div className="update-blocker-notes">
                  <span className="update-blocker-notes-title">Patch notes</span>
                  <div className="update-blocker-notes-body">{availableUpdate.notes}</div>
                </div>
              ) : null}

              <button
                className="update-blocker-btn"
                onClick={handleInstallUpdate}
                disabled={installingUpdate}
              >
                {installingUpdate ? "Installation en cours..." : "Mettre a jour"}
              </button>

              {installingUpdate ? (
                <p className="update-blocker-installing">Telechargement et installation... L app va redemarrer automatiquement.</p>
              ) : null}
              {updaterError ? (
                <p className="update-blocker-error">{updaterError}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!hasCurrentPageAccess ? (
          <section className="panel admin-blocked-panel">
            <div className="admin-blocked">
              <div className="admin-blocked-glow" />
              <span className="admin-blocked-icon">🔒</span>
              <h2>Acces bloque</h2>
              <p className="admin-blocked-desc">
                Le module <strong>{pageMeta[page].title}</strong> n est pas active pour ce compte.
              </p>
              <p className="admin-blocked-hint">
                Un admin peut modifier cet acces depuis le panneau Admin.
              </p>
            </div>
          </section>
        ) : null}

        {hasCurrentPageAccess && page === "dashboard" &&
          renderDashboard(
            tickets,
            ticketMonthSummary,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            selectedMonth,
            lastTicketsSyncAt,
            reimbursementDetails.total,
            dashboardSubscriptions,
            subPanelOpen,
            subFormLabel,
            subFormAmount,
            subFormError,
            changeMonthWithHistory,
            handleRefreshTickets,
            csvImportUiBusy,
            handleOpenTicketModal,
            handleOpenCsvImportPicker,
            () => { setSubFormError(""); setSubPanelOpen((v) => !v); },
            () => setSubDeletePanelOpen((v) => !v),
            setSubFormLabel,
            setSubFormAmount,
            handleAddSubscription,
            handleDeleteSubscription,
            subDeletePanelOpen,
            dashboardUnexpectedModalOpen,
            () => setDashboardUnexpectedModalOpen(true),
            () => setDashboardUnexpectedModalOpen(false)
          )}
        {hasCurrentPageAccess && page === "tickets" &&
          renderTickets(
            visibleTickets,
            tickets,
            ticketMonthSummary,
            tickets.length,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            collaborators,
            budgetPreviewTicket,
            budgetDetailsOpen,
            reimbursementForm,
            reimbursementDetails,
            submittingReimbursements,
            deletingReimbursementRow,
            undoingReimbursement,
            reimbursementStatus,
            reimbursementError,
            selectedMonth,
            lastTicketsSyncAt,
            ticketsSheetModalOpen,
            ticketSearch,
            // ticketCategoryChoices, // REMOVE: not in renderTickets signature
            ticketCategoryFilter,
            ticketStatusFilter,
            ticketSortMode,
            changeMonthWithHistory,
            handleRefreshTickets,
            csvImportUiBusy,
            handleTicketSearchChange,
            handleTicketCategoryFilterChange,
            handleTicketStatusFilterChange,
            handleTicketSortModeChange,
            handleOpenTicketModal,
            handleOpenCsvImportPicker,
            () => setTicketsSheetModalOpen(true),
            () => setTicketsSheetModalOpen(false),
            () => setBudgetDetailsOpen(false),
            handleReimbursementFormChangeWithHistory,
            handleSubmitReimbursements,
            handleDeleteReimbursement,
            handleTicketHover,
            handleTicketLeave,
            editingTicket,
            editTicketForm,
            editTicketSaving,
            editTicketError,
            handleStartEditTicket,
            handleCancelEditTicket,
            (patch: Partial<{ date: string; description: string; category: string; amount: string }>) => setEditTicketForm((prev) => ({ ...prev, ...patch })),
            handleSaveEditTicket
          )}
        {hasCurrentPageAccess && page === "audits" &&
          renderAudits(
            tickets,
            ticketMonthSummary,
            selectedMonth,
            auditReferenceMonth,
            auditReferenceState,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            lastTicketsSyncAt,
            dashboardSubscriptions,
            changeMonthWithHistory,
            handleAuditReferenceMonthChange,
            handleRefreshAudits
          )}
        {hasCurrentPageAccess && page === "compare" &&
          renderCompare(
            comparePrimaryMonth,
            compareSecondaryMonth,
            comparePrimaryState,
            compareSecondaryState,
            compareSortMode,
            selectedMonth,
            dashboardSubscriptions,
            handleComparePrimaryMonthChange,
            handleCompareSecondaryMonthChange,
            handleSwapCompareMonths,
            handleSyncCompareWithSelectedMonth,
            handleRefreshCompare,
            setCompareSortMode
          )}
        {hasCurrentPageAccess && page === "collab" &&
          renderCollab(
            collabIdentity,
            collaborators,
            sharedNote,
            collabStatus,
            collabError,
            collabFeed,
            collabSignals,
            followedPeerId,
            collabConnectionState,
            handleCollabNameChange,
            handleSharedNoteChangeWithHistory,
            handleOpenSecondSession,
            handleCollabBoardPointerMove,
            handleCollabBoardPointerLeave,
            handleSendCollabSignal,
            handleClearSharedNote,
            setFollowedPeerId
          )}
        {hasCurrentPageAccess && page === "settings" &&
          renderSettings(
            currentAccount,
            accountSettingsForm,
            accountSettingsLoading,
            accountSettingsStatus,
            accountSettingsError,
            (patch) => {
              setAccountSettingsForm((current) => ({ ...current, ...patch }));
              setAccountSettingsError("");
              setAccountSettingsStatus("");
            },
            handleSaveQuickProfile,
            handleSaveAccountSettings,
            handleLogout
          )}
        {hasCurrentPageAccess && page === "version" &&
          renderVersionPage(
            updaterStatus,
            availableUpdate,
            checkingUpdates,
            installingUpdate,
            updaterMessage,
            updaterError,
            selectedPatchVersion,
            setSelectedPatchVersion,
            handleCheckUpdates,
            handleInstallUpdate
          )}
        {hasCurrentPageAccess && page === "admin" &&
          renderAdminPage(
            currentAccount,
            adminUsers,
            adminLoading,
            adminError,
            handleLoadAdminUsers,
            handleToggleUserRole,
            handleOpenPermissions,
            collaborators,
            adminSearch,
            setAdminSearch,
            adminRoleFilter,
            setAdminRoleFilter
          )}
        {hasCurrentPageAccess && !["dashboard", "tickets", "audits", "compare", "collab", "settings", "version", "admin"].includes(page) && renderPlaceholder(page)}

      </main>
      <input
        ref={csvImportInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={handleCsvImportFileSelected}
      />
      {historyModal}
      {permissionsModal}
      {deniedAccessModal}

      {pendingHistoryAction ? (
        <div className="history-toast-stack">
          <div className="history-toast history-toast-info history-toast-pending">
            <div className="history-toast-pending-loader">
              <div className="card-loader">
                <span className="card-loader-ring" />
                <span className="card-loader-orbit" />
                <span className="card-loader-core" />
              </div>
            </div>
            <div className="history-toast-content">
              <div className="history-toast-head">
                <span className="history-toast-shortcut">
                  {pendingHistoryAction === "undo" ? "Ctrl+Z" : "Ctrl+Y"}
                </span>
                <strong>
                  {pendingHistoryAction === "undo" ? "Retour en arrière..." : "Refaire..."}
                </strong>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {historyToasts.length > 0 ? (
        <div className="history-toast-stack">
          {historyToasts.map((toast) => (
            <div key={toast.id} className={`history-toast history-toast-${toast.tone}`}>
              <div className="history-toast-content">
                <div className="history-toast-head">
                  {toast.author ? (
                    <span className="history-toast-author">{toast.author}</span>
                  ) : null}
                  {toast.shortcut ? (
                    <span className="history-toast-shortcut">{toast.shortcut}</span>
                  ) : null}
                  <strong>{toast.title}</strong>
                </div>
                <p>{toast.detail}</p>
              </div>
              <button
                type="button"
                className="history-toast-close"
                onClick={() => setHistoryToasts((current) => current.filter((item) => item.id !== toast.id))}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {isTicketModalOpen &&
        renderTicketModal(
          newTicketForm,
          submittingTicket,
          submitTicketError,
          voiceSupported,
          voiceListening,
          voiceTranscript,
          voiceStep,
          voiceFeedback,
          selectedMonth,
          ticketCategoryPromptOpen,
          ticketFollowUpPrompt,
          handleCloseTicketModal,
          handleSubmitTicket,
          handleAnotherTicketChoice,
          handleNewTicketFormChange,
          handleToggleVoice
        )}
      {renderCsvImportModal(
        csvImportModalOpen,
        csvImportFileName,
        csvImportTargetMonth,
        selectedMonth,
        csvImportSummary,
        csvImportDrafts,
        sharedCsvImportSession,
        csvImportLoading || csvImportSharedSubmitting,
        csvImportSubmitting,
        csvImportError,
        csvImportStatus,
        handleCloseCsvImportModal,
        handleOpenCsvImportPicker,
        handleCsvImportSelectAll,
        handleCsvImportDraftIncludeChange,
        handleCsvImportDraftChange,
        handleConfirmCsvImport
      )}
    </div>
  );
}

export default App;
