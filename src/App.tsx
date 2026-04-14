import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
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

type AccountProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pseudo: string;
  cursorColor: string;
  createdAt: string;
  passwordHash?: string;
  role: "admin" | "user";
  sessionToken: string;
};

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
    };

type VoiceStep = "date" | "amount" | "description" | "confirm";

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
    { key: "courses", label: "Courses", planned: 350, matchCategories: [categoryOptions[0]] },
    { key: "fast_food", label: "Fast-Food / Livraison", planned: 140, matchCategories: [categoryOptions[1], categoryOptions[3]] },
    { key: "restaurant", label: "Restaurant", planned: 120, matchCategories: [categoryOptions[2]] },
    { key: "telephonie", label: "Téléphonie", planned: 20, matchCategories: [categoryOptions[4]] },
    { key: "netflix", label: "Netflix", planned: 14, matchCategories: [categoryOptions[5]] },
    { key: "amazon_prime", label: "Amazon Prime", planned: 7, matchCategories: [categoryOptions[6]] },
    { key: "apple_spotify", label: "Apple / Spotify", planned: 18, matchCategories: [categoryOptions[7]] },
    { key: "quotidien", label: "Quotidien", planned: 120, matchCategories: [categoryOptions[8]] },
    { key: "essence", label: "Essence", planned: 180, matchCategories: [categoryOptions[9]] },
    { key: "autres", label: "Autres", planned: 90, matchCategories: [categoryOptions[10]] },
  ] satisfies TicketBudgetLine[],
};

const voiceHints = [
  "Date: aujourd'hui, hier, 12 avril ou 12/04/2026",
  "Montant: 18 euros 50 ou 18,50",
  "Description: Carrefour, Netflix, Burger King",
  "Confirmation: dis valider, recommencer ou annuler",
];

const voiceStepOrder: VoiceStep[] = ["date", "amount", "description", "confirm"];

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
  {
    category: categoryOptions[0],
    keywords: ["carrefour", "auchan", "super u", "courses", "alimentation", "lidl"],
  },
  {
    category: categoryOptions[1],
    keywords: ["fast food", "burger", "kfc", "mcdo", "burger king", "subway"],
  },
  {
    category: categoryOptions[2],
    keywords: ["restaurant", "resto", "brasserie", "pizzeria"],
  },
  {
    category: categoryOptions[3],
    keywords: ["uber eats", "livraison", "deliveroo"],
  },
  {
    category: categoryOptions[4],
    keywords: ["sfr", "telephonie", "telephone", "forfait"],
  },
  { category: categoryOptions[5], keywords: ["netflix"] },
  { category: categoryOptions[6], keywords: ["amazon prime", "prime video"] },
  { category: categoryOptions[7], keywords: ["spotify", "apple", "itunes", "apple music"] },
  { category: categoryOptions[8], keywords: ["quotidien", "pharmacie", "maison", "entretien"] },
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
const collabPresenceTimeoutMs = 7_000;
const collabSignalLifetimeMs = 4_800;
const collabColors = ["#f58d68", "#f2c56e", "#76d0b2", "#90bbea", "#ff9b7a", "#b8a1ff"];
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

function normalizeAccountProfile(data: unknown): AccountProfile | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const row = data as Record<string, unknown>;
  const email = normalizeEmail(String(row.email ?? ""));

  if (!email) {
    return null;
  }

  return {
    id: String(row.id ?? row.userId ?? row.uuid ?? email),
    email,
    firstName: String(row.firstName ?? row.first_name ?? row.prenom ?? ""),
    lastName: String(row.lastName ?? row.last_name ?? row.nom ?? ""),
    pseudo: String(row.pseudo ?? row.displayName ?? row.nickname ?? ""),
    cursorColor: String(row.cursorColor ?? row.cursor_color ?? row.color ?? collabColors[0]),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    passwordHash: typeof row.passwordHash === "string" ? row.passwordHash : undefined,
    role: (row as Record<string, unknown>).role === "admin" ? "admin" : "user",
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

function inferCategoryFromTranscript(transcript: string) {
  const normalized = normalizeVoiceCommand(transcript);

  for (const rule of categoryKeywords) {
    if (rule.keywords.some((keyword) => normalized.includes(normalizeVoiceCommand(keyword)))) {
      return rule.category;
    }
  }

  return categoryOptions[9];
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
      .replace(/\b(valider|recommencer|annuler)\b/gi, " ")
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
  return `Verifie le recap puis dis valider, recommencer ou annuler.${form.category ? ` Categorie detectee: ${form.category}.` : ""}`;
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

function getTicketCategoryChoices(tickets: Ticket[]) {
  return [...new Set(tickets.map((ticket) => ticket.category.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
}

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

function renderMonthFilter(selectedMonth: string, onMonthChange: (month: string) => void) {
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
            className={`month-pill ${selectedMonth === month.value ? "active" : ""}`}
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
  onClose: () => void,
  onSubmit: () => void,
  onChange: (patch: Partial<NewTicketForm>) => void,
  onToggleVoice: () => void
) {
  const voiceStepValues = [
    { key: "date" as VoiceStep, label: "Date", value: form.date || "En attente" },
    { key: "amount" as VoiceStep, label: "Montant", value: form.amount || "En attente" },
    { key: "description" as VoiceStep, label: "Description", value: form.description || "En attente" },
    { key: "confirm" as VoiceStep, label: "Categorie", value: form.category || "A confirmer" },
  ];

  return (
    <div className="modal-backdrop">
      <div className="ticket-modal">
        <div className="ticket-modal-head">
          <div>
            <span className="eyebrow">Nouveau ticket</span>
            <h2>Ajouter une depense sur {getSelectedMonthLabel(selectedMonth).toLowerCase()}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="voice-panel">
          <div className="voice-panel-head">
            <div>
              <span className="eyebrow">Assistant vocal</span>
              <strong>Checklist guidee premium: je te demande, tu reponds, ca remplit tout seul.</strong>
            </div>
            <button
              type="button"
              className={`voice-btn ${voiceListening ? "active" : ""}`}
              onClick={onToggleVoice}
              disabled={!voiceSupported}
            >
              {voiceListening ? "Arreter l ecoute" : "Lancer la dictee"}
            </button>
          </div>

          <div className="voice-step-card">
            <span>Etape en cours</span>
            <strong>{getVoiceStepLabel(voiceStep)}</strong>
            <p>{getVoiceStepPrompt(voiceStep, form)}</p>
          </div>

          <div className="voice-progress">
            {voiceStepValues.map((item, index) => (
              <div
                className={`voice-progress-chip ${getVoiceStepState(item.key, voiceStep, form)}`}
                key={item.label}
              >
                <span>{index + 1}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>

          <div className={`voice-transcript ${voiceTranscript ? "live" : ""}`}>
            {voiceTranscript || "Parle librement, la reponse reconnue s affiche ici en direct."}
          </div>

          {voiceFeedback ? <div className="voice-feedback">{voiceFeedback}</div> : null}

          <div className="voice-checklist">
            {voiceStepValues.map((item) => (
              <div
                className={`voice-check-item ${getVoiceStepState(item.key, voiceStep, form)}`}
                key={item.label}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="voice-hints">
            {voiceHints.map((hint) => (
              <span key={hint}>{hint}</span>
            ))}
          </div>

          {!voiceSupported ? (
            <div className="status warn">
              La dictee vocale n est pas disponible sur ce navigateur/runtime.
            </div>
          ) : null}
        </div>

        <div className="ticket-form-grid">
          <label className={`field-block ${voiceStep === "date" ? "active" : ""}`}>
            <span>Date</span>
            <input
              className="field-input"
              type="date"
              value={form.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          </label>

          <label className={`field-block ${voiceStep === "amount" ? "active" : ""}`}>
            <span>Montant</span>
            <input
              className="field-input"
              type="text"
              inputMode="decimal"
              placeholder="12,34"
              value={form.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
            />
          </label>

          <label className={`field-block field-block-wide ${voiceStep === "description" ? "active" : ""}`}>
            <span>Description</span>
            <input
              className="field-input"
              type="text"
              placeholder="Ex: Carrefour"
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>

          <label className={`field-block field-block-wide ${voiceStep === "confirm" ? "active" : ""}`}>
            <span>Categorie</span>
            <select
              className="field-input"
              value={form.category}
              onChange={(event) => onChange({ category: event.target.value })}
            >
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>

        {submitError ? <div className="status warn">{submitError}</div> : null}

        <div className="ticket-modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="primary-btn" onClick={onSubmit} disabled={submitting}>
            {submitting ? "Envoi..." : "Enregistrer le ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderDashboard(
  tickets: Ticket[],
  loading: boolean,
  refreshing: boolean,
  error: string,
  selectedMonth: string,
  lastSyncLabel: string,
  reimbursementTotal: number,
  subscriptions: DashboardSubscription[],
  subPanelOpen: boolean,
  subFormLabel: string,
  subFormAmount: string,
  subFormError: string,
  onMonthChange: (month: string) => void,
  onRefreshTickets: () => void,
  onOpenTicketModal: () => void,
  onToggleSubPanel: () => void,
  onToggleSubDeletePanel: () => void,
  onSubFormLabelChange: (v: string) => void,
  onSubFormAmountChange: (v: string) => void,
  onAddSubscription: () => void,
  onDeleteSubscription: (id: string) => void,
  subDeletePanelOpen: boolean
) {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const sentCount = tickets.filter((ticket) => ticket.sent).length;
  const pendingCount = tickets.length - sentCount;
  const recentTickets = tickets.slice(-6).reverse();
  const isBusy = loading || refreshing;

  const monthlyIncome = ticketsFinancePreset.monthlyIncome;
  const budgetLines = computeTicketBudgetLines(tickets);
  const budgetPlannedTotal = budgetLines.reduce((sum, line) => sum + line.planned, 0);
  const currentRemaining = monthlyIncome - monthlyTotal;
  const theoreticalRemaining = monthlyIncome - budgetPlannedTotal;
  const unexpectedSpend = currentRemaining - theoreticalRemaining;
  const unexpectedSpendTone = getBudgetDifferenceTone(unexpectedSpend);
  const sentRatio = tickets.length > 0 ? Math.round((sentCount / tickets.length) * 100) : 0;
  const totalWithReimbursements = monthlyTotal + reimbursementTotal;

  const dashboardStatus = loading
    ? "Chargement des donnees..."
    : error
      ? "Connexion Google Sheets a verifier"
      : lastSyncLabel
        ? `Google Sheets OK • sync ${lastSyncLabel}`
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
              <button className="outline-btn" onClick={onRefreshTickets}>
                {isBusy ? "Actualisation..." : "Actualiser"}
              </button>
            </div>
          </div>

          <div className="dashboard-v3-right">
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
                <>
                  <div className="dashboard-v3-row">
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
                    <div className="dashboard-v3-period-card">
                      {renderMonthFilter(selectedMonth, onMonthChange)}
                    </div>
                  </div>

                  <div className="dashboard-v3-row">
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
                  </div>
                </>
              );
            })()}

            <span className="dashboard-v3-status-line">
              {refreshing ? <span className="sync-badge">Synchro...</span> : null}
              Etat connexion : {dashboardStatus}
            </span>
          </div>
        </div>
      </section>

      <section className="stats-grid dashboard-v3-kpi-grid">
        <article className="card accent-blue dashboard-v3-kpi-card">
          <span className="card-label">Solde du compte</span>
          <strong className="card-value">{euro.format(currentRemaining)}</strong>
          <span className="card-sub">Revenu - depenses du mois</span>
        </article>

        <article className="card accent-mint dashboard-v3-kpi-card">
          <span className="card-label">Reste en cours</span>
          <strong className="card-value">{euro.format(currentRemaining)}</strong>
          <span className="card-sub">Disponible estime actuellement</span>
        </article>

        <article className="card accent-rose dashboard-v3-kpi-card">
          <span className="card-label">Reste theorique</span>
          <strong className="card-value">{euro.format(theoreticalRemaining)}</strong>
          <span className="card-sub">Selon ton budget cible</span>
        </article>

        <article className="card accent-salmon dashboard-v3-kpi-card">
          <span className="card-label">Depense non prevue</span>
          <strong className={`card-value tickets-diff-text ${unexpectedSpendTone}`}>
            {formatBudgetDifference(unexpectedSpend)}
          </strong>
          <span className="card-sub">Ecart reel vs theorique</span>
        </article>
      </section>

      <section className="dashboard-v3-bottom-grid">
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
    </>
  );
}

function renderTickets(
  tickets: Ticket[],
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
  reimbursementStatus: string,
  reimbursementError: string,
  selectedMonth: string,
  lastSyncLabel: string,
  searchQuery: string,
  categoryChoices: string[],
  categoryFilter: string,
  statusFilter: TicketStatusFilter,
  sortMode: TicketSortMode,
  onMonthChange: (month: string) => void,
  onRefreshTickets: () => void,
  onSearchChange: (value: string) => void,
  onCategoryFilterChange: (value: string) => void,
  onStatusFilterChange: (value: TicketStatusFilter) => void,
  onSortModeChange: (value: TicketSortMode) => void,
  onOpenTicketModal: () => void,
  onCloseBudgetDetails: () => void,
  onReimbursementFormChange: (patch: Partial<ReimbursementFormLine>) => void,
  onSubmitReimbursements: () => void,
  onDeleteReimbursement: (row: number) => void,
  onTicketHover: (ticket: Ticket) => void,
  onTicketLeave: () => void
) {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const isBusy = loading || refreshing;
  const selectedMonthLabel = getSelectedMonthLabel(selectedMonth);

  const budgetLines = computeTicketBudgetLines(tickets);
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
          {renderMonthFilter(selectedMonth, onMonthChange)}
          <button className="ghost-btn refresh-btn" onClick={onRefreshTickets}>
            {isBusy ? "Actualisation..." : "Actualiser"}
          </button>
          <button className="primary-btn" onClick={onOpenTicketModal}>
            Ajouter un ticket
          </button>
        </div>
      </section>

      <section className="stats-grid tickets-stats-grid">
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

      <section className="content-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Registre</span>
              <div className="panel-title-row">
                <h2>Liste des tickets</h2>
                {refreshing ? <span className="sync-badge">Synchro...</span> : null}
              </div>
            </div>
            <button className="panel-link">Exporter</button>
          </div>

          <div className="panel-body table-body">
            <div className="ticket-toolbar">
              <div className="ticket-toolbar-head">
                <div className="ticket-toolbar-title">
                  <span className="ticket-toolbar-kicker">Recherche et filtres</span>
                  <strong>Affinage instantane des tickets</strong>
                </div>

                <div className="ticket-toolbar-meta">
                  <span>{tickets.length} ticket(s) affiches sur {totalTicketsCount}</span>
                  <span>
                    {searchQuery.trim() || categoryFilter !== "all" || statusFilter !== "all"
                      ? "Filtres actifs"
                      : refreshing
                        ? "Synchro en cours..."
                        : lastSyncLabel
                          ? `Synchro ${lastSyncLabel}`
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
                    {categoryChoices.map((category) => (
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
              tickets.map((ticket, index) => {
                const ticketKey = getTicketKey(ticket);
                const watchingPeers = collaborators.filter((peer) => peer.focusTicketKey === ticketKey);

                return (
                  <div
                    className={`ticket-row ${watchingPeers.length ? "ticket-row-active" : ""}`}
                    key={`${ticket.date}-${ticket.description}-${index}`}
                    onMouseEnter={() => onTicketHover(ticket)}
                    onMouseLeave={onTicketLeave}
                  >
                    <div className="ticket-main">
                      <div className="ticket-title-row">
                        <strong>{ticket.description || "Sans description"}</strong>
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

            {!loading && !error && tickets.length === 0 && (
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
                          className={`reimbursement-active-item ${isDeleting ? "reimbursement-deleting" : ""}`}
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
        <article className="panel">
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
                {profileLoading ? "Enregistrement..." : "Sauvegarder"}
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
  onToggleRole: (targetEmail: string, newRole: "admin" | "user") => void
) {
  if (currentAccount.role !== "admin") {
    return (
      <section className="panel admin-blocked-panel">
        <div className="admin-blocked">
          <span className="admin-blocked-icon">🔒</span>
          <h2>Acces restreint</h2>
          <p>Cette section est reservee aux administrateurs.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel admin-panel">
      <div className="admin-header">
        <div>
          <h1>Administration</h1>
          <p className="admin-subtitle">Gestion des comptes et autorisations</p>
        </div>
        <button className="primary-btn" onClick={onLoadUsers} disabled={adminLoading}>
          {adminLoading ? "Chargement..." : "Rafraichir"}
        </button>
      </div>

      {adminError && <div className="admin-error">{adminError}</div>}

      {adminUsers.length === 0 && !adminLoading && !adminError && (
        <div className="admin-empty">
          <p>Cliquez sur Rafraichir pour charger les comptes.</p>
        </div>
      )}

      {adminUsers.length > 0 && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Pseudo</th>
                <th>Prenom</th>
                <th>Nom</th>
                <th>Email</th>
                <th>Couleur</th>
                <th>Role</th>
                <th>Inscrit le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((user) => {
                const isSelf = user.email === currentAccount.email;
                return (
                  <tr key={user.id} className={isSelf ? "admin-row-self" : ""}>
                    <td className="admin-cell-name">
                      <span className="admin-user-dot" style={{ background: user.cursorColor }} />
                      {user.pseudo || "—"}
                    </td>
                    <td>{user.firstName || "—"}</td>
                    <td>{user.lastName || "—"}</td>
                    <td className="admin-cell-email">{user.email}</td>
                    <td>
                      <span className="admin-color-chip" style={{ background: user.cursorColor }} />
                    </td>
                    <td>
                      <span className={`admin-role-badge ${user.role === "admin" ? "admin-role-admin" : "admin-role-user"}`}>
                        {user.role === "admin" ? "Admin" : "Utilisateur"}
                      </span>
                    </td>
                    <td className="admin-cell-date">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td>
                      {isSelf ? (
                        <span className="admin-you-tag">Vous</span>
                      ) : (
                        <button
                          className={user.role === "admin" ? "outline-btn admin-demote-btn" : "primary-btn admin-promote-btn"}
                          onClick={() => onToggleRole(user.email, user.role === "admin" ? "user" : "admin")}
                          disabled={adminLoading}
                        >
                          {user.role === "admin" ? "Retirer admin" : "Promouvoir admin"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
  const [subFormLabel, setSubFormLabel] = useState("");
  const [subFormAmount, setSubFormAmount] = useState("");
  const [subFormError, setSubFormError] = useState("");
  const [ticketMonthSummary, setTicketMonthSummary] = useState<TicketMonthSummary | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [refreshingTickets, setRefreshingTickets] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [lastTicketsSyncLabel, setLastTicketsSyncLabel] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState("all");
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatusFilter>("all");
  const [ticketSortMode, setTicketSortMode] = useState<TicketSortMode>("date_desc");
  const [reloadSeed, setReloadSeed] = useState(0);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [budgetDetailsOpen, setBudgetDetailsOpen] = useState(false);
  const [budgetPreviewTicket, setBudgetPreviewTicket] = useState<Ticket | null>(null);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [submitTicketError, setSubmitTicketError] = useState("");
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
    category: categoryOptions[0],
  });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRestartRecognitionRef = useRef(false);
  const voiceStepRef = useRef<VoiceStep>("date");
  const collabChannelRef = useRef<BroadcastChannel | null>(null);
  const collabIdentityRef = useRef<CollabIdentity>(createCollabIdentity());
  const pageRef = useRef<PageKey>(getInitialPage());
  const selectedMonthRef = useRef(selectedMonth);
  const ticketsRef = useRef<Ticket[]>([]);
  const lastLoadedMonthRef = useRef("");
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
  const ticketCategoryChoices = getTicketCategoryChoices(tickets);
  const visibleTickets = filterAndSortTickets(
    tickets,
    deferredTicketSearch,
    ticketCategoryFilter,
    ticketStatusFilter,
    ticketSortMode
  );
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
    ticketsRef.current = tickets;
  }, [tickets]);

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
    options?: { broadcast?: boolean }
  ) => {
    const shouldBroadcast = options?.broadcast !== false;
    const now = Date.now();

    const fullEvent: HistoryEvent = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      ...event,
      createdAt: now,
    };

    setHistoryEvents((current) => [fullEvent, ...current].slice(0, 40));
    setHistoryToasts((current) => [fullEvent, ...current].slice(0, 5));

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
  };

  const handleUndo = async () => {
    const remoteAction = reimbursementUndoActionRef.current;

    if (remoteAction?.kind === "delete") {
      try {
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
        return;
      }
    }

    if (historyState.past.length === 0) {
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
        return;
      }
    }

    if (historyState.future.length === 0) {
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
  };

  const canUndo =
    historyState.past.length > 0 || reimbursementUndoActionRef.current !== null;
  const canRedo =
    historyState.future.length > 0 || reimbursementRedoActionRef.current !== null;

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
        handleUndo();
        return;
      }

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
          { broadcast: false }
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
        { broadcast: false }
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
        setReimbursementDetails({
          entries: [],
          ceTotal: 0,
          medecinTotal: 0,
          total: 0,
        });
        setLoadingTickets(false);
        setRefreshingTickets(false);
        return;
      }

      const hasVisibleTickets = ticketsRef.current.length > 0;
      const keepCurrentView =
        hasVisibleTickets && lastLoadedMonthRef.current === selectedMonth;

      try {
        if (!keepCurrentView) {
          setLoadingTickets(true);
        } else {
          setRefreshingTickets(true);
        }
        setTicketsError("");

        const data = await fetchTicketsFromSheets(selectedMonth);
        const normalized = normalizeTickets(data);
        const normalizedSummary = normalizeTicketMonthSummary(data);
        const normalizedReimbursements = normalizeReimbursementDetails(data);
        setTickets(normalized);
        setTicketMonthSummary(
          normalizedSummary ?? {
            accountBalance: null,
            currentRemaining: ticketsFinancePreset.monthlyIncome - normalized.reduce((sum, ticket) => sum + ticket.amount, 0),
            theoreticalRemaining:
              ticketsFinancePreset.monthlyIncome -
              computeTicketBudgetLines(normalized).reduce((sum, line) => sum + line.planned, 0),
            unexpectedSpendTotal: null,
            source: "fallback",
          }
        );
        setReimbursementDetails(normalizedReimbursements);
        lastLoadedMonthRef.current = selectedMonth;
        setLastTicketsSyncLabel(
          new Date().toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      } catch (error) {
        console.error("Chargement Google Sheets impossible:", error);
        setTicketsError(getErrorMessage(error));
        if (!keepCurrentView) {
          setTickets([]);
          setTicketMonthSummary(null);
          setReimbursementDetails({
            entries: [],
            ceTotal: 0,
            medecinTotal: 0,
            total: 0,
          });
        }
      } finally {
        setLoadingTickets(false);
        setRefreshingTickets(false);
      }
    };

    loadTickets();
  }, [currentAccount, selectedMonth, reloadSeed]);

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
    if (typeof window === "undefined") {
      return;
    }

    const triggerRefresh = () => {
      if (document.visibilityState === "visible") {
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
    }, 45000);

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
    setNewTicketForm((current) => ({
      ...current,
      date: current.date || new Date().toISOString().slice(0, 10),
      description: "",
      amount: "",
      category: categoryOptions[0],
    }));
    setVoiceTranscript("");
    setVoiceStep("date");
    setVoiceFeedback("Pret. Clique sur la dictee et reponds a la premiere question.");
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
    shouldRestartRecognitionRef.current = false;
    recognitionRef.current?.stop();
    setVoiceListening(false);
    setVoiceStep("date");
  };

  const handleRefreshTickets = () => {
    setReloadSeed((value) => value + 1);
  };

  const changePageWithHistory = (nextPage: PageKey) => {
    if (nextPage === page) {
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

  const handleSubmitTicket = async () => {
    if (!newTicketForm.date || !newTicketForm.amount || !newTicketForm.description.trim()) {
      setSubmitTicketError("Date, montant et description sont obligatoires.");
      return;
    }

    try {
      setSubmittingTicket(true);
      setSubmitTicketError("");
      setVoiceFeedback("");
      shouldRestartRecognitionRef.current = false;
      recognitionRef.current?.stop();
      setVoiceListening(false);

      const response = await createTicketInSheets(selectedMonth, newTicketForm);
      const responseObject = response as { success?: boolean; error?: string };

      if (responseObject?.success === false) {
        throw new Error(responseObject.error || "Ajout du ticket refuse par Google Sheets.");
      }

      setIsTicketModalOpen(false);
      setReloadSeed((value) => value + 1);
    } catch (error) {
      setSubmitTicketError(getErrorMessage(error));
    } finally {
      setSubmittingTicket(false);
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
      setReloadSeed((value) => value + 1);
    } catch (error) {
      setReimbursementError(getErrorMessage(error));
    } finally {
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
    if (!currentAccount || currentAccount.role !== "admin") return;
    setAdminLoading(true);
    setAdminError("");
    try {
      const users = await fetchAllUsersFromSheets(currentAccount.email, currentAccount.sessionToken);
      setAdminUsers(users);
    } catch (err) {
      setAdminError(getErrorMessage(err));
    } finally {
      setAdminLoading(false);
    }
  };

  const handleToggleUserRole = async (targetEmail: string, newRole: "admin" | "user") => {
    if (!currentAccount || currentAccount.role !== "admin") return;
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
    } catch (err) {
      setAdminError(getErrorMessage(err));
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (!currentAccount) {
      return;
    }

    if (page === "admin" && currentAccount.role !== "admin") {
      setPage("dashboard");
      return;
    }

    if (page === "admin" && currentAccount.role === "admin" && !adminLoading && adminUsers.length === 0) {
      void handleLoadAdminUsers();
    }
  }, [page, currentAccount, adminLoading, adminUsers.length]);

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

  const handleVoiceResult = (transcript: string) => {
    const normalizedCommand = normalizeVoiceCommand(transcript);
    const currentStep = voiceStepRef.current;

    if (currentStep === "confirm") {
      if (normalizedCommand.includes("annuler")) {
        handleCloseTicketModal();
        return;
      }

      if (normalizedCommand.includes("recommencer")) {
        setNewTicketForm((current) => ({
          ...current,
          amount: "",
          description: "",
          category: categoryOptions[0],
        }));
        setVoiceTranscript("");
        setVoiceFeedback("On repart proprement. Redis la date.");
        setVoiceStep("date");
        return;
      }

      if (normalizedCommand.includes("valider")) {
        void handleSubmitTicket();
        return;
      }

      const detectedCategory = detectVoiceCategory(transcript);
      if (detectedCategory && detectedCategory !== categoryOptions[9]) {
        setNewTicketForm((current) => ({ ...current, category: detectedCategory }));
        setVoiceFeedback(`Categorie ajustee: ${detectedCategory}. Dis maintenant valider, recommencer ou annuler.`);
        return;
      }

      setVoiceFeedback("Dis valider, recommencer ou annuler.");
      return;
    }

    const patch = applyVoiceStepValue(currentStep, transcript, newTicketForm);

    if (
      (currentStep === "date" && !patch.date) ||
      (currentStep === "amount" && !patch.amount) ||
      (currentStep === "description" && !patch.description)
    ) {
      setVoiceFeedback(`Je n ai pas bien compris la ${getVoiceStepLabel(currentStep).toLowerCase()}. Redis calmement.`);
      return;
    }

    setNewTicketForm((current) => ({ ...current, ...applyVoiceStepValue(currentStep, transcript, current) }));
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

    const detectedCategory = detectVoiceCategory(transcript);
    setVoiceFeedback(
      `Description comprise.${detectedCategory ? ` Categorie detectee: ${detectedCategory}.` : ""} Dis valider, recommencer ou annuler.`
    );
  };

  const handleToggleVoice = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSubmitTicketError("La dictee vocale n est pas disponible ici.");
      return;
    }

    if (voiceListening && recognitionRef.current) {
      shouldRestartRecognitionRef.current = false;
      recognitionRef.current.stop();
      setVoiceListening(false);
      setVoiceFeedback("Dictée arrêtée.");
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
      setVoiceFeedback("La dictee vocale a rencontre un probleme.");
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
    setVoiceFeedback(getVoiceStepPrompt(voiceStepRef.current, newTicketForm));

    try {
      recognition.start();
    } catch {
      shouldRestartRecognitionRef.current = false;
      setVoiceListening(false);
      setVoiceFeedback("Impossible de lancer la dictee pour le moment.");
    }
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
    const y = Math.max(0, Math.min(100, ((event.clientY - mainRect.top) / mainRect.height) * 100));
    const now = Date.now();

    if (now - lastPointerSentAtRef.current < 24) {
      return;
    }

    lastPointerSentAtRef.current = now;
    broadcastPointer(x, y, true, mainScrollYRef.current);
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

  const currentMeta = pageMeta[page];

  const menu: { key: PageKey; label: string; badge?: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "tickets", label: "Tickets", badge: String(tickets.length) },
    { key: "annual", label: "Envoi annuel" },
    { key: "audits", label: "Audits" },
    { key: "compare", label: "Comparateur" },
    { key: "subscriptions", label: "Abonnements", badge: "6" },
    { key: "collab", label: "Collab", badge: String(collaborators.length + 1) },
    { key: "settings", label: "Parametres" },
    { key: "version", label: "Version" },
    ...(currentAccount.role === "admin" ? [{ key: "admin" as PageKey, label: "Admin" }] : []),
  ];
  const mainViewportRect = mainElRef.current?.getBoundingClientRect() ?? null;

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
                    Heure, raccourci, action et resultat. Seulement les vraies actions appliquees.
                  </p>
                </div>

                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setHistoryPanelOpen(false)}
                >
                  Fermer
                </button>
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
                            {sheetEvents.map((eventItem) => (
                              <div key={eventItem.id} className={`history-log-row ${eventItem.tone}`}>
                                <div className="history-log-time">
                                  {new Date(eventItem.createdAt).toLocaleTimeString("fr-FR")}
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
                                  </div>
                                  <p>{eventItem.detail}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="history-log-empty-col">Aucune action Google Sheets.</div>
                        )}
                      </div>

                      <div className="history-log-col">
                        <div className="history-log-section-label history-log-section-app">App</div>
                        {appEvents.length > 0 ? (
                          <div className="history-log-list">
                            {appEvents.map((eventItem) => (
                              <div key={eventItem.id} className={`history-log-row ${eventItem.tone}`}>
                                <div className="history-log-time">
                                  {new Date(eventItem.createdAt).toLocaleTimeString("fr-FR")}
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
                                  </div>
                                  <p>{eventItem.detail}</p>
                                </div>
                              </div>
                            ))}
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
                return (
                  <button
                    key={item.key}
                    className={`nav-item ${page === item.key ? "active" : ""}`}
                    onClick={() => changePageWithHistory(item.key)}
                  >
                    <span className="nav-item-top">
                      <span>{item.label}</span>
                      {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                    </span>
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
          </div>
        </div>
  
        <div className="global-cursor-layer">
          {visibleRemoteCursors.map((peer) => {
            if (!mainViewportRect) {
              return null;
            }

            const scrollDelta = peer.scrollY - mainScrollY;
            const leftPx = mainViewportRect.left + (peer.cursorX / 100) * mainViewportRect.width;
            const topPx =
              mainViewportRect.top +
              (peer.cursorY / 100) * mainViewportRect.height +
              scrollDelta;

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

        {page === "dashboard" &&
          renderDashboard(
            tickets,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            selectedMonth,
            lastTicketsSyncLabel,
            reimbursementDetails.total,
            dashboardSubscriptions,
            subPanelOpen,
            subFormLabel,
            subFormAmount,
            subFormError,
            changeMonthWithHistory,
            handleRefreshTickets,
            handleOpenTicketModal,
            () => { setSubFormError(""); setSubPanelOpen((v) => !v); },
            () => setSubDeletePanelOpen((v) => !v),
            setSubFormLabel,
            setSubFormAmount,
            handleAddSubscription,
            handleDeleteSubscription,
            subDeletePanelOpen
          )}
        {page === "tickets" &&
          renderTickets(
            visibleTickets,
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
            reimbursementStatus,
            reimbursementError,
            selectedMonth,
            lastTicketsSyncLabel,
            ticketSearch,
            ticketCategoryChoices,
            ticketCategoryFilter,
            ticketStatusFilter,
            ticketSortMode,
            changeMonthWithHistory,
            handleRefreshTickets,
            handleTicketSearchChange,
            handleTicketCategoryFilterChange,
            handleTicketStatusFilterChange,
            handleTicketSortModeChange,
            handleOpenTicketModal,
            () => setBudgetDetailsOpen(false),
            handleReimbursementFormChangeWithHistory,
            handleSubmitReimbursements,
            handleDeleteReimbursement,
            handleTicketHover,
            handleTicketLeave
          )}
        {page === "collab" &&
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
        {page === "settings" &&
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
        {page === "version" &&
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
        {page === "admin" &&
          renderAdminPage(
            currentAccount,
            adminUsers,
            adminLoading,
            adminError,
            handleLoadAdminUsers,
            handleToggleUserRole
          )}
        {!["dashboard", "tickets", "collab", "settings", "version", "admin"].includes(page) && renderPlaceholder(page)}

      </main>
      {historyModal}

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
          handleCloseTicketModal,
          handleSubmitTicket,
          (patch) => setNewTicketForm((current) => ({ ...current, ...patch })),
          handleToggleVoice
        )}
    </div>
  );
}

export default App;
