import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "./App.css";

type PageKey =
  | "dashboard"
  | "tickets"
  | "annual"
  | "audits"
  | "compare"
  | "subscriptions"
  | "collab"
  | "settings";

type Ticket = {
  date: string;
  description: string;
  category: string;
  amount: number;
  sent: boolean;
  sortIndex?: number;
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

type AccountProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  cursorColor: string;
  createdAt: string;
  passwordHash?: string;
};

type AuthMode = "signin" | "signup";

type SignInForm = {
  email: string;
  password: string;
};

type SignUpForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  cursorColor: string;
};

type AccountSettingsForm = {
  firstName: string;
  lastName: string;
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

type Collaborator = CollabIdentity & {
  page: PageKey;
  context: string;
  cursorX: number;
  cursorY: number;
  insideBoard: boolean;
  lastSeen: number;
  focusTicketKey: string;
  focusTicketLabel: string;
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

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const categoryOptions = [
  "🛒 Courses",
  "🍔 Fast-Food",
  "🍽️Restaurant",
  "🚲 Uber eats",
  "📱 Téléphonie",
  "🎬 Netflix",
  "🚚 Amazon Prime",
  "🍏 Apple / Spotify",
  "🧺Quotidien",
  "❓ Autres",
];

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
  février: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  août: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  décembre: "12",
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

const categoryShare = [
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
};

const collabChannelName = "budget-pc-collab-lab";
const collabIdentityStoragePrefix = "budget-pc-collab-identity";
const collabSharedNoteStorageKey = "budget-pc-collab-shared-note";
const authAccountsStorageKey = "budget-pc-auth-accounts";
const authSessionStorageKey = "budget-pc-auth-session";
const collabPresenceTimeoutMs = 7_000;
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
];

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

function getAccountDisplayName(account: Pick<AccountProfile, "firstName" | "lastName" | "email">) {
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
    cursorColor: String(row.cursorColor ?? row.cursor_color ?? row.color ?? collabColors[0]),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    passwordHash: typeof row.passwordHash === "string" ? row.passwordHash : undefined,
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

function normalizeTickets(data: unknown): Ticket[] {
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
        row.category ?? row.categorie ?? row.Category ?? row.catégorie ?? ""
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
    cursorColor: form.cursorColor,
    newPassword: form.newPassword,
  })) as { success?: boolean; error?: string; account?: unknown; user?: unknown; profile?: unknown };

  if (response?.success === false) {
    throw new Error(response.error || "Mise a jour du compte refusee par le serveur.");
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

function renderGoogleSheetsError(error: string) {
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
        <code>acces public, JSON invalide, colonnes non reconnues</code>
      </div>
    </div>
  );
}

function getSelectedMonthLabel(selectedMonth: string) {
  return monthOptions.find((month) => month.value === selectedMonth)?.label ?? selectedMonth;
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
  onMonthChange: (month: string) => void,
  onRefreshTickets: () => void,
  onOpenTicketModal: () => void
) {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const sentCount = tickets.filter((ticket) => ticket.sent).length;
  const pendingCount = tickets.length - sentCount;
  const recentTickets = tickets.slice(0, 3);
  const isBusy = loading || refreshing;

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">Budget desktop</span>
          <h1>Un cockpit propre pour suivre tes depenses sans friction.</h1>
          <p>
            La base est prete pour evoluer en vrai logiciel de gestion:
            navigation claire, synthese utile et modules bien separes.
          </p>

          <div className="hero-actions">
            <button className="primary-btn" onClick={onOpenTicketModal}>
              Nouvelle depense
            </button>
            {refreshing ? <span className="sync-badge">Synchro...</span> : null}
            <button className="ghost-btn" onClick={onRefreshTickets}>
              {isBusy ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
        </div>

        <div className="hero-aside">
          {renderMonthFilter(selectedMonth, onMonthChange)}
          <div className="hero-metric">
            <span className="metric-label">Budget analyse</span>
            <strong>{euro.format(monthlyTotal)}</strong>
            <span className="metric-trend up">
              {loading
                ? "Chargement..."
                : `${tickets.length} ticket(s) charges${lastSyncLabel ? ` • sync ${lastSyncLabel}` : ""}`}
            </span>
          </div>

          <div className="hero-mini-grid">
            <div className="hero-mini-tile tone-mint">
              <span>Tickets valides</span>
              <strong>{sentCount}</strong>
            </div>
            <div className="hero-mini-tile tone-gold">
              <span>Tickets a revoir</span>
              <strong>{pendingCount}</strong>
            </div>
            <div className="hero-mini-tile tone-sky">
              <span>Abonnements</span>
              <strong>6</strong>
            </div>
            <div className="hero-mini-tile tone-salmon">
              <span>Alertes</span>
              <strong>{error ? 1 : 0}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card accent-blue">
          <span className="card-label">Total du mois</span>
          <strong className="card-value">{euro.format(monthlyTotal)}</strong>
          <span className="card-sub">Flux issu de Google Sheets</span>
        </article>

        <article className="card accent-gold">
          <span className="card-label">Tickets traites</span>
          <strong className="card-value">{tickets.length}</strong>
          <span className="card-sub">Tickets charges dans l app</span>
        </article>

        <article className="card accent-salmon">
          <span className="card-label">A envoyer</span>
          <strong className="card-value">{pendingCount}</strong>
          <span className="card-sub">Encore non envoyes</span>
        </article>

        <article className="card accent-mint">
          <span className="card-label">Objectifs budget</span>
          <strong className="card-value">{sentCount}</strong>
          <span className="card-sub">Tickets deja envoyes</span>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Activite recente</span>
              <h2>Derniers mouvements</h2>
            </div>
            <button className="panel-link">Ouvrir le journal</button>
          </div>

          <div className="panel-body stack">
            {loading && <div className="status info">Chargement des tickets...</div>}

            {!loading && error && renderGoogleSheetsError(error)}

            {!loading &&
              !error &&
              recentTickets.map((ticket, index) => (
                <div className="activity-item" key={`${ticket.date}-${ticket.description}-${index}`}>
                  <div>
                    <strong>{ticket.description || "Sans description"}</strong>
                    <span>
                      {ticket.category || "Sans categorie"} • {ticket.date || "Sans date"}
                    </span>
                  </div>
                  <strong>{euro.format(ticket.amount)}</strong>
                </div>
              ))}

            {!loading && !error && recentTickets.length === 0 && (
              <div className="status info">Aucun ticket trouve.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Etat rapide</span>
              <h2>Points de controle</h2>
            </div>
          </div>

          <div className="panel-body stack">
            {!loading && !error && <div className="status ok">Connexion Google Sheets OK.</div>}
            {loading && <div className="status info">Chargement en cours.</div>}
            {error && renderGoogleSheetsError(error)}
            <div className="status info">Le comparateur est alimente avec les donnees chargees.</div>
          </div>
        </article>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Repartition</span>
              <h2>Poids des categories</h2>
            </div>
          </div>

          <div className="panel-body stack">
            {categoryShare.map((item) => (
              <div className="progress-row" key={item.label}>
                <div className="progress-head">
                  <span>{item.label}</span>
                  <strong>{item.value}%</strong>
                </div>
                <div className="progress-track">
                  <div
                    className={`progress-bar ${item.tone}`}
                    style={{ width: `${item.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel spotlight-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Signal du mois</span>
              <h2>Focus abonnement</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <p className="spotlight-copy">
              Les depenses recurrentes representent une part stable du budget,
              mais deux lignes meritent une renegociation avant avril.
            </p>
            <div className="spotlight-stat tone-gold">
              <span>Gain potentiel</span>
              <strong>{euro.format(18)}</strong>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}

function renderTickets(
  tickets: Ticket[],
  totalTicketsCount: number,
  loading: boolean,
  refreshing: boolean,
  error: string,
  collaborators: Collaborator[],
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
  onTicketHover: (ticket: Ticket) => void,
  onTicketLeave: () => void
) {
  const monthlyTotal = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const sentCount = tickets.filter((ticket) => ticket.sent).length;
  const pendingCount = tickets.length - sentCount;
  const fastFoodTotal = tickets
    .filter((ticket) => ticket.category.toLowerCase() === "fast-food")
    .reduce((sum, ticket) => sum + ticket.amount, 0);
  const isBusy = loading || refreshing;

  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Tickets</span>
          <h1>Vue mensuelle des depenses capturees</h1>
          <p>
            Un espace compact pour verifier le flux, les montants et l etat d envoi
            sur {getSelectedMonthLabel(selectedMonth).toLowerCase()}.
          </p>
        </div>
        <div className="topbar-actions">
          {renderMonthFilter(selectedMonth, onMonthChange)}
          {refreshing ? <span className="sync-badge">Synchro...</span> : null}
          <button className="ghost-btn" onClick={onRefreshTickets}>
            {isBusy ? "Actualisation..." : "Actualiser"}
          </button>
          <button className="primary-btn" onClick={onOpenTicketModal}>
            Ajouter un ticket
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card accent-blue">
          <span className="card-label">Total affiche</span>
          <strong className="card-value">{euro.format(monthlyTotal)}</strong>
          <span className="card-sub">{tickets.length} tickets visibles</span>
        </article>

        <article className="card accent-salmon">
          <span className="card-label">Fast-food</span>
          <strong className="card-value">{euro.format(fastFoodTotal)}</strong>
          <span className="card-sub">Categorie detectee</span>
        </article>

        <article className="card accent-mint">
          <span className="card-label">Deja envoyes</span>
          <strong className="card-value">{sentCount}</strong>
          <span className="card-sub">{pendingCount} restants</span>
        </article>

        <article className="card accent-gold">
          <span className="card-label">Anomalies</span>
          <strong className="card-value">{error ? 1 : 0}</strong>
          <span className="card-sub">Controle de chargement</span>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Registre</span>
              <h2>Liste des tickets</h2>
            </div>
            <button className="panel-link">Exporter</button>
          </div>

          <div className="panel-body table-body">
            <div className="ticket-toolbar">
              <div className="ticket-toolbar-grid">
                <input
                  className="field-input"
                  type="search"
                  value={searchQuery}
                  placeholder="Rechercher un ticket, une date ou une categorie"
                  onChange={(event) => onSearchChange(event.target.value)}
                />

                <select
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

                <select
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

                <select
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
              </div>

              <div className="ticket-toolbar-meta">
                <span>
                  {tickets.length} ticket(s) affiches sur {totalTicketsCount}
                </span>
                {searchQuery.trim() || categoryFilter !== "all" || statusFilter !== "all" ? (
                  <span>Filtres actifs</span>
                ) : (
                  <span>
                    {refreshing
                      ? "Synchro en cours..."
                      : lastSyncLabel
                        ? `Synchro ${lastSyncLabel}`
                        : "Vue complete"}
                  </span>
                )}
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
                    <strong>{ticket.description || "Sans description"}</strong>
                    <span>
                      {ticket.date || "Sans date"} • {ticket.category || "Sans categorie"}
                    </span>
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
                  <span className={`ticket-badge ${ticket.sent ? "sent" : "pending"}`}>
                    {ticket.sent ? "Envoye" : "En attente"}
                  </span>
                  <strong className="ticket-amount">{euro.format(ticket.amount)}</strong>
                </div>
                );
              })}

            {!loading && !error && tickets.length === 0 && (
              <div className="status info">Aucun ticket trouve.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Resume</span>
              <h2>Actions rapides</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="status ok">{sentCount} tickets sont deja dans le flux d envoi.</div>
            <div className="status warn">{pendingCount} tickets demandent encore une validation.</div>
            <div className="status info">Le poste fast-food reste le plus actif cette semaine.</div>
            {collaborators.some((peer) => peer.page === "tickets") ? (
              <div className="mini-note">
                {collaborators
                  .filter((peer) => peer.page === "tickets")
                  .map((peer) => `${peer.name} sur ${peer.context || getSelectedMonthLabel(selectedMonth)}`)
                  .join(" • ")}
              </div>
            ) : null}
            <div className="mini-note">
              Ici, on affichera ensuite les vrais filtres, tris et actions desktop Tauri.
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
  onNameChange: (value: string) => void,
  onSharedNoteChange: (value: string) => void,
  onOpenSecondSession: () => void,
  onBoardPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void,
  onBoardPointerLeave: () => void
) {
  const activePeers = collaborators.filter((item) => Date.now() - item.lastSeen < collabPresenceTimeoutMs);
  const boardPeers = activePeers.filter((item) => item.page === "collab" && item.insideBoard);

  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Mode multi</span>
          <h1>Collab locale style Canva, testable sur un seul PC.</h1>
          <p>
            Ouvre une deuxieme session, bouge la souris dans la zone de test et tu verras
            l autre curseur apparaitre en direct.
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
          <span className="card-sub">Toi compris, sur cette machine</span>
        </article>

        <article className="card accent-gold">
          <span className="card-label">Curseurs visibles</span>
          <strong className="card-value">{boardPeers.length}</strong>
          <span className="card-sub">Dans la zone de collaboration</span>
        </article>

        <article className="card accent-salmon">
          <span className="card-label">Bloc-note partage</span>
          <strong className="card-value">{sharedNote.length}</strong>
          <span className="card-sub">Caracteres synchro en live</span>
        </article>
      </section>

      <section className="content-grid collab-grid">
        <article className="panel collab-board-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Canvas local</span>
              <h2>Zone curseurs partages</h2>
            </div>
            <div className="collab-legend">
              <span className="collab-dot" style={{ backgroundColor: collabIdentity.color }} />
              <strong>{collabIdentity.name}</strong>
            </div>
          </div>

          <div className="panel-body">
            <div
              className="collab-board"
              onPointerMove={onBoardPointerMove}
              onPointerLeave={onBoardPointerLeave}
            >
              <div className="collab-board-copy">
                <strong>Déplace ta souris ici</strong>
                <span>Les autres sessions ouvertes sur ton PC verront ton curseur bouger ici en direct.</span>
              </div>

              {boardPeers.map((peer) => (
                <div
                  className="remote-cursor"
                  key={peer.id}
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
              <div className="collab-presence-card" key={peer.id}>
                <div className="collab-presence-row">
                  <span className="collab-dot" style={{ backgroundColor: peer.color }} />
                  <strong>{peer.name}</strong>
                </div>
                <span>
                  {getPageLabel(peer.page)}
                  {peer.context ? ` • ${peer.context}` : ""}
                </span>
                {peer.focusTicketLabel ? <span>{peer.focusTicketLabel}</span> : null}
              </div>
            ))}

            {activePeers.length === 0 ? (
              <div className="status info">
                Ouvre une deuxieme session pour voir une presence distante apparaitre ici.
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
              className="collab-note-input"
              value={sharedNote}
              onChange={(event) => onSharedNoteChange(event.target.value)}
              placeholder="Ecris ici depuis une session et regarde l autre se mettre a jour."
            />
            <div className="mini-note">
              Ce proto est 100% local: parfait pour valider l experience avant de brancher un vrai backend temps reel.
            </div>
          </div>
        </article>

        <article className="panel spotlight-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Suite logique</span>
              <h2>Apres le test souris</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="activity-item simple">
              <div>
                <strong>Presence par ticket</strong>
                <span>Afficher qui regarde quel ticket ou quel mois.</span>
              </div>
            </div>
            <div className="activity-item simple">
              <div>
                <strong>Selection partagee</strong>
                <span>Montrer le ticket survole ou edite par l autre session.</span>
              </div>
            </div>
            <div className="activity-item simple">
              <div>
                <strong>Backend temps reel</strong>
                <span>Pousser ensuite la meme UX sur deux vraies machines.</span>
              </div>
            </div>
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
  updaterStatus: UpdaterStatus | null,
  availableUpdate: AvailableUpdate | null,
  checkingUpdates: boolean,
  installingUpdate: boolean,
  updaterMessage: string,
  updaterError: string,
  onChange: (patch: Partial<AccountSettingsForm>) => void,
  onSave: () => void,
  onCheckUpdates: () => void,
  onInstallUpdate: () => void,
  onLogout: () => void
) {
  return (
    <>
      <section className="topbar">
        <div>
          <span className="eyebrow">Compte</span>
          <h1>Profil et identite multi</h1>
          <p>Ton nom, ton email et la couleur de curseur qui sera utilisee dans la collab.</p>
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
              <span className="panel-kicker">Profil</span>
              <h2>Informations du compte</h2>
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

            <label className="field-block">
              <span>Mot de passe actuel</span>
              <input
                className="field-input"
                type="password"
                value={form.currentPassword}
                onChange={(event) => onChange({ currentPassword: event.target.value })}
                placeholder="Obligatoire pour sauvegarder"
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
                <span>Confirmation nouveau mot de passe</span>
                <input
                  className="field-input"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) => onChange({ confirmPassword: event.target.value })}
                  placeholder="Retape le nouveau mot de passe"
                />
              </label>
            </div>

            {profileStatus ? <div className="status ok">{profileStatus}</div> : null}
            {profileError ? <div className="status warn">{profileError}</div> : null}

            <div className="ticket-modal-actions">
              <button className="primary-btn" onClick={onSave} disabled={profileLoading}>
                {profileLoading ? "Enregistrement..." : "Enregistrer le profil"}
              </button>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Apercu multi</span>
              <h2>Presence future</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="activity-item simple">
              <div>
                <strong>{getAccountDisplayName(account)}</strong>
                <span>{account.email}</span>
              </div>
            </div>
            <div className="ticket-peer-chip settings-cursor-preview">
              <span className="collab-dot" style={{ backgroundColor: form.cursorColor }} />
              Ton curseur apparaitra avec cette couleur dans la vue collab.
            </div>
            <div className="status info">
              Ton profil peut maintenant vivre au dela du stockage local de l app.
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Mises a jour</span>
              <h2>Version desktop et releases</h2>
            </div>
          </div>

          <div className="panel-body stack">
            <div className="activity-item simple">
              <div>
                <strong>Version actuelle</strong>
                <span>{updaterStatus?.currentVersion || "0.1.0"}</span>
              </div>
            </div>

            <div className={`status ${updaterStatus?.configured ? "ok" : "warn"}`}>
              {updaterStatus?.configured
                ? `Updater configure avec ${updaterStatus.endpointCount} endpoint(s).`
                : "Updater non configure pour l instant. Il manque encore la cle publique et l endpoint de release."}
            </div>

            {availableUpdate ? (
              <div className="status info">
                Mise a jour detectee: v{availableUpdate.version}
                {availableUpdate.pubDate ? ` - ${new Date(availableUpdate.pubDate).toLocaleDateString("fr-FR")}` : ""}
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
      </section>
    </>
  );
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
    email: "",
    password: "",
    confirmPassword: "",
    cursorColor: collabColors[0],
  });
  const [accountSettingsForm, setAccountSettingsForm] = useState<AccountSettingsForm>({
    firstName: "",
    lastName: "",
    email: "",
    cursorColor: collabColors[0],
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [accountSettingsLoading, setAccountSettingsLoading] = useState(false);
  const [accountSettingsStatus, setAccountSettingsStatus] = useState("");
  const [accountSettingsError, setAccountSettingsError] = useState("");
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updaterMessage, setUpdaterMessage] = useState("");
  const [updaterError, setUpdaterError] = useState("");
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [refreshingTickets, setRefreshingTickets] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [lastTicketsSyncLabel, setLastTicketsSyncLabel] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("12");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState("all");
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatusFilter>("all");
  const [ticketSortMode, setTicketSortMode] = useState<TicketSortMode>("date_desc");
  const [reloadSeed, setReloadSeed] = useState(0);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [submitTicketError, setSubmitTicketError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceStep, setVoiceStep] = useState<VoiceStep>("date");
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [collabIdentity, setCollabIdentity] = useState<CollabIdentity>(createCollabIdentity);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
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
  const pageRef = useRef<PageKey>(getInitialPage());
  const selectedMonthRef = useRef(selectedMonth);
  const ticketsRef = useRef<Ticket[]>([]);
  const lastLoadedMonthRef = useRef("");
  const collabNoteTimestampRef = useRef(0);
  const lastPointerSentAtRef = useRef(0);
  const startupUpdaterCheckedRef = useRef(false);
  const deferredTicketSearch = useDeferredValue(ticketSearch);
  const isTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const ticketCategoryChoices = getTicketCategoryChoices(tickets);
  const visibleTickets = filterAndSortTickets(
    tickets,
    deferredTicketSearch,
    ticketCategoryFilter,
    ticketStatusFilter,
    ticketSortMode
  );
  const showUpdateBanner = Boolean(
    availableUpdate && dismissedUpdateVersion !== availableUpdate.version
  );
  const updateBannerDateLabel =
    showUpdateBanner && availableUpdate?.pubDate
      ? new Date(availableUpdate.pubDate).toLocaleDateString("fr-FR")
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
    if (!currentAccount) {
      return;
    }

    setAccountSettingsForm({
      firstName: currentAccount.firstName,
      lastName: currentAccount.lastName,
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
        setCollaborators((current) => current.filter((item) => item.id !== message.userId));
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
        return;
      }

      if (message.type === "presence") {
        setCollaborators((current) =>
          upsertCollaboratorEntry(current, {
            ...message.user,
            page: message.page,
            context: message.context,
            cursorX: current.find((item) => item.id === message.user.id)?.cursorX ?? 50,
            cursorY: current.find((item) => item.id === message.user.id)?.cursorY ?? 50,
            insideBoard: current.find((item) => item.id === message.user.id)?.insideBoard ?? false,
            lastSeen: message.timestamp,
            focusTicketKey: current.find((item) => item.id === message.user.id)?.focusTicketKey ?? "",
            focusTicketLabel: current.find((item) => item.id === message.user.id)?.focusTicketLabel ?? "",
          })
        );
        return;
      }

      if (message.type === "pointer") {
        setCollaborators((current) =>
          upsertCollaboratorEntry(current, {
            ...message.user,
            page: message.page,
            context: current.find((item) => item.id === message.user.id)?.context ?? "",
            cursorX: message.x,
            cursorY: message.y,
            insideBoard: message.insideBoard,
            lastSeen: message.timestamp,
            focusTicketKey: current.find((item) => item.id === message.user.id)?.focusTicketKey ?? "",
            focusTicketLabel: current.find((item) => item.id === message.user.id)?.focusTicketLabel ?? "",
          })
        );
        return;
      }

      if (message.type === "focus") {
        setCollaborators((current) =>
          upsertCollaboratorEntry(current, {
            ...message.user,
            page: message.page,
            context: current.find((item) => item.id === message.user.id)?.context ?? "",
            cursorX: current.find((item) => item.id === message.user.id)?.cursorX ?? 50,
            cursorY: current.find((item) => item.id === message.user.id)?.cursorY ?? 50,
            insideBoard: current.find((item) => item.id === message.user.id)?.insideBoard ?? false,
            lastSeen: message.timestamp,
            focusTicketKey: message.focusTicketKey,
            focusTicketLabel: message.focusTicketLabel,
          })
        );
      }
    };

    const heartbeat = window.setInterval(() => {
      broadcastPresence();
      setCollaborators((current) =>
        current.filter((item) => Date.now() - item.lastSeen < collabPresenceTimeoutMs)
      );
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
    const loadTickets = async () => {
      if (!currentAccount) {
        setTickets([]);
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
        setTickets(normalized);
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
    const password = signUpForm.password;
    const confirmPassword = signUpForm.confirmPassword;

    if (!firstName || !lastName || !email || !password) {
      setAuthError("Prenom, nom, email et mot de passe sont obligatoires.");
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
    setAuthMode("signin");
    setAuthError("");
    setAuthStatus("");
    setSignInForm((current) => ({ ...current, email: currentAccount?.email || current.email, password: "" }));
    setPage("dashboard");
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
      setAccountSettingsError("Le mot de passe actuel est obligatoire pour sauvegarder.");
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
      setAccountSettingsStatus("Profil distant mis a jour.");
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
      setDismissedUpdateVersion("");
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
      setVoiceFeedback("Dictée arretee.");
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
  };

  const broadcastTicketFocus = (focusTicketKey: string, focusTicketLabel: string) => {
    collabChannelRef.current?.postMessage({
      type: "focus",
      user: collabIdentity,
      page: "tickets",
      focusTicketKey,
      focusTicketLabel,
      timestamp: Date.now(),
    } satisfies CollabMessage);
  };

  const handleTicketHover = (ticket: Ticket) => {
    broadcastTicketFocus(
      getTicketKey(ticket),
      `${ticket.description || "Sans description"} • ${ticket.date || "Sans date"}`
    );
  };

  const handleTicketLeave = () => {
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
    }

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

  const broadcastPointer = (x: number, y: number, insideBoard: boolean) => {
    collabChannelRef.current?.postMessage({
      type: "pointer",
      user: collabIdentity,
      page: "collab",
      x,
      y,
      insideBoard,
      timestamp: Date.now(),
    } satisfies CollabMessage);
  };

  const handleCollabBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
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
    broadcastPointer(x, y, true);
  };

  const handleCollabBoardPointerLeave = () => {
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
  ];

  return (
    <div className="app-shell">
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
              {menu.map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${page === item.key ? "active" : ""}`}
                  onClick={() => setPage(item.key)}
                >
                  <span>{item.label}</span>
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </button>
              ))}
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

      <main className="main">
        {showUpdateBanner && availableUpdate ? (
          <section className="update-banner">
            <div className="update-banner-copy">
              <span className="eyebrow">Mise a jour disponible</span>
              <h2>Version {availableUpdate.version} prete a etre installee</h2>
              <p>
                {availableUpdate.notes?.trim() ||
                  "Une nouvelle version de Budget PC est disponible pour toi et les autres postes installes."}
              </p>
              {updateBannerDateLabel ? (
                <span className="update-banner-meta">Publiee le {updateBannerDateLabel}</span>
              ) : null}
            </div>

            <div className="update-banner-actions">
              {checkingUpdates ? <span className="sync-badge">Synchro...</span> : null}
              <button
                className="ghost-btn"
                onClick={() => setDismissedUpdateVersion(availableUpdate.version)}
                disabled={installingUpdate}
              >
                Plus tard
              </button>
              <button
                className="primary-btn"
                onClick={handleInstallUpdate}
                disabled={checkingUpdates || installingUpdate}
              >
                {installingUpdate ? "Installation..." : "Installer la MAJ"}
              </button>
            </div>
          </section>
        ) : null}

        {page === "dashboard" &&
          renderDashboard(
            tickets,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            selectedMonth,
            lastTicketsSyncLabel,
            setSelectedMonth,
            handleRefreshTickets,
            handleOpenTicketModal
          )}
        {page === "tickets" &&
          renderTickets(
            visibleTickets,
            tickets.length,
            loadingTickets,
            refreshingTickets,
            ticketsError,
            collaborators,
            selectedMonth,
            lastTicketsSyncLabel,
            ticketSearch,
            ticketCategoryChoices,
            ticketCategoryFilter,
            ticketStatusFilter,
            ticketSortMode,
            setSelectedMonth,
            handleRefreshTickets,
            setTicketSearch,
            setTicketCategoryFilter,
            setTicketStatusFilter,
            setTicketSortMode,
            handleOpenTicketModal,
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
            handleCollabNameChange,
            handleSharedNoteChange,
            handleOpenSecondSession,
            handleCollabBoardPointerMove,
            handleCollabBoardPointerLeave
          )}
        {page === "settings" &&
          renderSettings(
            currentAccount,
            accountSettingsForm,
            accountSettingsLoading,
            accountSettingsStatus,
            accountSettingsError,
            updaterStatus,
            availableUpdate,
            checkingUpdates,
            installingUpdate,
            updaterMessage,
            updaterError,
            (patch) => {
              setAccountSettingsForm((current) => ({ ...current, ...patch }));
              setAccountSettingsError("");
              setAccountSettingsStatus("");
            },
            handleSaveAccountSettings,
            handleCheckUpdates,
            handleInstallUpdate,
            handleLogout
          )}
        {!["dashboard", "tickets", "collab", "settings"].includes(page) && renderPlaceholder(page)}
      </main>
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
