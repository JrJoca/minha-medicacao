"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  BellRing,
  CalendarDays,
  Check,
  Clock3,
  FileImage,
  LoaderCircle,
  ListPlus,
  LogOut,
  MessageCircle,
  MoreVertical,
  Pause,
  Pencil,
  Pill,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getBackend, getPasswordAuth, loginEmail, resolveApplicationUser, type ApplicationUser } from "@/lib/neon";
import { syncRoutineNotifications } from "@/lib/native-notifications";
import { parseQuantity, unitLabel, type QuantityUnit, type RoutineDose } from "@/lib/inventory";
import { MedicationInventory } from "@/components/medication-inventory";
import {
  emptyPrescriptionDraft,
  parsePrescriptionText,
  readPrescriptionImage,
  type PrescriptionMedicineDraft,
} from "@/lib/prescription-ocr";

type Medicine = { id: string; name: string; dosage: string; link?: string };
type Intake = { id: string; routine_id: string; taken_at: string };
type Routine = {
  id: string;
  name: string;
  medicineIds: string[];
  doses: Record<string,RoutineDose>;
  frequencyKind: "daily" | "other" | null;
  stockTracking: boolean;
  archivedAt: string | null;
  intakeId: string | null;
  time: string;
  limit: string;
  period: string;
  durationValue: number | null;
  durationUnit: "days" | "weeks" | null;
  noEndDate: boolean;
  currentDay: number;
  totalDays: number | null;
  taken: boolean;
  takenAt: string | null;
  paused: boolean;
};

const initialMedicines: Medicine[] = [];
const initialRoutines: Routine[] = [];

export default function Home() {
  const [medicines, setMedicines] = useState(initialMedicines);
  const [routines, setRoutines] = useState(initialRoutines);
  const [user, setUser] = useState<ApplicationUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "verify" | "recover" | "reset">("login");
  const [pendingAuthEmail, setPendingAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authRefresh, setAuthRefresh] = useState(0);
  const authRevision = useRef(0);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [medicineOpen, setMedicineOpen] = useState(false);
  const [prescriptionOpen, setPrescriptionOpen] = useState(false);
  const [prescriptionFile, setPrescriptionFile] = useState<File | null>(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState("");
  const [prescriptionDrafts, setPrescriptionDrafts] = useState<
    PrescriptionMedicineDraft[]
  >([]);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrReading, setOcrReading] = useState(false);
  const [ocrNotice, setOcrNotice] = useState("");
  const [isTypedPrescription, setIsTypedPrescription] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportIntakes, setReportIntakes] = useState<Intake[]>([]);
  const [historyIntakes, setHistoryIntakes] = useState<Intake[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEnd, setHistoryEnd] = useState(() => localDateKey(new Date()));
  const [historyStart, setHistoryStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return localDateKey(date);
  });
  const [editingReportRoutineId, setEditingReportRoutineId] = useState<
    string | null
  >(null);
  const [correctedDate, setCorrectedDate] = useState("");
  const [correctedTime, setCorrectedTime] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return localDateKey(date);
  });
  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [includeMedicineNames, setIncludeMedicineNames] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [routineDoses,setRoutineDoses] = useState<Record<string,RoutineDose>>({});
  const [frequencyKind,setFrequencyKind] = useState<"daily"|"other">("daily");
  const [routineSaving,setRoutineSaving] = useState(false);
  const [routineError,setRoutineError] = useState("");
  const routineSaveLock=useRef(false);
  const routineSaveCommand=useRef<{payload:string;id:string}|null>(null);
  const [inventoryRevision,setInventoryRevision]=useState(0);
  const intakeLock=useRef(false);
  const [intakeBusy,setIntakeBusy]=useState(false);
  const intakeCommands=useRef(new Map<string,{id:string;at:string}>());
  const [medicineToAdd, setMedicineToAdd] = useState("");
  const [noEndDate, setNoEndDate] = useState(false);
  const [notice, setNotice] = useState(
    "A próxima rotina está programada para 19:00.",
  );
  const [currentTimeInMinutes, setCurrentTimeInMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const isViewer = user?.role === "viewer";
  const viewerMutationBlocked = () => {
    if (!isViewer) return false;
    setNotice("Perfil visualizador: alterações não são permitidas.");
    return true;
  };
  const routinesByTime = useMemo(
    () =>
      [...routines].filter(r=>!r.archivedAt).sort(
        (first, second) =>
          timeToMinutes(first.time) - timeToMinutes(second.time),
      ),
    [routines],
  );
  const active = routinesByTime.filter((r) => !r.paused);
  const done = active.filter((r) => r.taken).length;
  const progress = active.length ? Math.round((done / active.length) * 100) : 0;
  const next = active.find(
    (routine) =>
      !routine.taken && timeToMinutes(routine.time) >= currentTimeInMinutes,
  );
  const medicineNames = (ids: string[]) =>
    ids.map((id) => medicines.find((m) => m.id === id)?.name).filter(Boolean);
  const reportIsToday = reportDate === localDateKey(new Date());
  const reportRows = routines
    .filter((routine) => !routine.paused || reportIntakes.some(i=>i.routine_id===routine.id))
    .map((routine) => {
      const intake = reportIntakes.find(
        (item) => item.routine_id === routine.id,
      );
      return {
        routine,
        intake,
        status: (intake ? "taken" : reportIsToday ? "pending" : "missed") as "taken" | "pending" | "missed",
      };
    });
  const reportTaken = reportRows.filter((row) => row.status === "taken").length;
  const reportPending = reportRows.filter(
    (row) => row.status === "pending",
  ).length;
  const reportMissed = reportRows.filter(
    (row) => row.status === "missed",
  ).length;
  const historyRows = dateKeysBetween(historyStart, historyEnd)
    .reverse()
    .flatMap((date) =>
      routines.filter(r=>!r.archivedAt || historyIntakes.some(i=>i.routine_id===r.id && localDateKey(new Date(i.taken_at))===date)).map((routine) => {
        const intake = historyIntakes.find(
          (item) =>
            item.routine_id === routine.id &&
            localDateKey(new Date(item.taken_at)) === date,
        );
        const isToday = date === localDateKey(new Date());
        return {
          date,
          routine,
          intake,
          status: (intake ? "taken" : isToday ? "pending" : "missed") as "taken" | "pending" | "missed",
        };
      }),
    );

  const loadData = useCallback(async () => {
    const revision = authRevision.current;
    setDataLoading(true);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay=new Date(startOfDay);endOfDay.setDate(endOfDay.getDate()+1);
    const [medicineResult, routineResult, linkResult, intakeResult] =
      await Promise.all([
        getBackend()
          .from("medications")
          .select("id,name,dosage,reference_url")
          .order("created_at"),
        getBackend().from("medication_routines").select("*").order("created_at"),
        getBackend().from("routine_medications").select("routine_id,medication_id,quantity_per_intake,quantity_unit"),
        getBackend()
          .from("medication_intakes")
          .select("id,routine_id,taken_at")
          .gte("taken_at", startOfDay.toISOString()).lt("taken_at",endOfDay.toISOString()),
      ]);
    if (revision !== authRevision.current) return;
    const error =
      medicineResult.error ||
      routineResult.error ||
      linkResult.error ||
      intakeResult.error;
    if (error) {
      setNotice("Não foi possível carregar os dados: " + error.message);
      setDataLoading(false);
      return;
    }
    setMedicines(
      (medicineResult.data || []).map((m) => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage,
        link: m.reference_url || "",
      })),
    );
    const links = linkResult.data || [];
    const todayIntakes = intakeResult.data || [];
    setRoutines(
      (routineResult.data || []).map((r) => ({
        id: r.id,
        name: r.name,
        medicineIds: links
          .filter((l) => l.routine_id === r.id)
          .map((l) => l.medication_id),
        doses: Object.fromEntries(links.filter(l=>l.routine_id===r.id).map(l=>[l.medication_id,{quantity:l.quantity_per_intake == null ? "" : String(l.quantity_per_intake),unit:l.quantity_unit || "tablet"}])),
        frequencyKind:r.frequency_kind,
        stockTracking:r.stock_tracking_enabled,
        archivedAt:r.archived_at,
        intakeId:todayIntakes.find(i=>i.routine_id===r.id)?.id || null,
        time: String(r.scheduled_time).slice(0, 5),
        limit: String(r.deadline_time).slice(0, 5),
        period: r.period_description,
        durationValue: r.duration_value,
        durationUnit: r.duration_unit,
        noEndDate: r.has_no_end_date,
        currentDay: r.current_day,
        totalDays: r.total_days,
        taken: todayIntakes.some((i) => i.routine_id === r.id),
        takenAt:
          todayIntakes.find((i) => i.routine_id === r.id)?.taken_at || null,
        paused: r.status === "paused",
      })),
    );
    setDataLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const syncIdentity = async (identity: { id: string; email?: string } | null) => {
      if (!active) return;
      const revision = ++authRevision.current;
      setUser(null);
      intakeCommands.current.clear();
      setRoutineOpen(false);
      setRoutineDoses({});
      setMedicines([]);
      setRoutines([]);
      setReportIntakes([]);
      setHistoryIntakes([]);
      setReportOpen(false);
      setDataLoading(false);
      try {
        if (!identity) return;
        const account = await resolveApplicationUser(identity);
        if (!active || revision !== authRevision.current) return;
        setUser(account);
        void loadData();
      } catch (error) {
        if (active && revision === authRevision.current) {
          setAuthNotice(error instanceof Error ? error.message : "Não foi possível verificar a conta.");
        }
      } finally {
        if (active && revision === authRevision.current) setAuthLoading(false);
      }
    };
    void Promise.resolve().then(async () => {
      try {
        if (!active) return;
        setWhatsAppPhone(localStorage.getItem("medication-whatsapp-phone") || "");
        setIncludeMedicineNames(localStorage.getItem("medication-whatsapp-medicines") !== "false");
        const auth = getBackend().auth;
        const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
          queueMicrotask(() => { void syncIdentity(session?.user ?? null); });
        });
        unsubscribe = () => subscription.unsubscribe();
        const revision = authRevision.current;
        const { data, error } = await auth.getSession();
        if (error) throw error;
        if (active && revision === authRevision.current) await syncIdentity(data.session?.user ?? null);
      } catch (error) {
        if (!active) return;
        setAuthNotice(error instanceof Error ? error.message : "Não foi possível conectar. Tente novamente.");
        setAuthLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadData, authRefresh]);

  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      setCurrentTimeInMinutes(now.getHours() * 60 + now.getMinutes());
    };
    const intervalId = window.setInterval(updateCurrentTime, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(
    () => () => {
      if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
    },
    [prescriptionPreview],
  );

  useEffect(() => {
    if (!user || dataLoading) return;
    void syncRoutineNotifications(routines).catch((error: unknown) => {
      console.error("Não foi possível sincronizar as notificações", error);
    });
  }, [user, dataLoading, routines]);

  async function loadReport(dateKey: string) {
    const revision = authRevision.current;
    const start = new Date(`${dateKey}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    setReportLoading(true);
    const { data, error } = await getBackend()
      .from("medication_intakes")
      .select("id,routine_id,taken_at")
      .gte("taken_at", start.toISOString())
      .lt("taken_at", end.toISOString())
      .order("taken_at");
    if (revision !== authRevision.current) return;
    setReportLoading(false);
    if (error) {
      setReportIntakes([]);
      setNotice("Erro ao gerar relatório: " + error.message);
      return;
    }
    setReportIntakes((data || []) as Intake[]);
  }

  async function loadHistory(startKey = historyStart, endKey = historyEnd) {
    const revision = authRevision.current;
    const start = new Date(`${startKey}T00:00:00`);
    const end = new Date(`${endKey}T00:00:00`);
    end.setDate(end.getDate() + 1);
    setHistoryLoading(true);
    const { data, error } = await getBackend()
      .from("medication_intakes")
      .select("id,routine_id,taken_at")
      .gte("taken_at", start.toISOString())
      .lt("taken_at", end.toISOString())
      .order("taken_at", { ascending: false });
    if (revision !== authRevision.current) return;
    setHistoryLoading(false);
    if (error) {
      setHistoryIntakes([]);
      setNotice("Erro ao carregar histórico: " + error.message);
      return;
    }
    setHistoryIntakes((data || []) as Intake[]);
  }

  function handleReportOpen(open: boolean) {
    setReportOpen(open);
    if (!open) setEditingReportRoutineId(null);
    if (open) {
      void loadReport(reportDate);
      void loadHistory();
    }
  }

  async function toggleHistoryTaken(
    routine: Routine,
    date: string,
    intake?: Intake,
  ) {
    if (viewerMutationBlocked()) return;
    if (!user) return;
    if (!await changeIntake(routine,intake ? "undo" : "confirm",date,intake)) return;
    setNotice(
      intake
        ? "O dia foi alterado para não tomado."
        : "O dia foi alterado para tomado com o horário real do registro.",
    );
    await Promise.all([
      loadHistory(),
      date === reportDate ? loadReport(reportDate) : Promise.resolve(),
      loadData(),
    ]);
  }

  async function saveReportRecord(routine: Routine, intake?: Intake) {
    if (viewerMutationBlocked()) return;
    if (!user || !correctedDate || !correctedTime) return;
    const correctedAt = new Date(`${correctedDate}T${correctedTime}:00`);
    if (!await changeIntake(routine,intake ? "correct" : "confirm",correctedDate,intake,correctedAt.toISOString())) return;
    setEditingReportRoutineId(null);
    setCorrectedDate("");
    setCorrectedTime("");
    setNotice(
      intake
        ? "Data e horário da tomada foram atualizados."
        : "Tomada registrada no relatório.",
    );
    await Promise.all([loadReport(reportDate), loadHistory(), loadData()]);
  }

  function beginEditingRecord(
    routine: Routine,
    intake: Intake | undefined,
    date: string,
    editKey: string,
  ) {
    if (viewerMutationBlocked()) return;
    setEditingReportRoutineId(editKey);
    setCorrectedDate(
      intake ? localDateKey(new Date(intake.taken_at)) : date,
    );
    setCorrectedTime(
      intake
        ? new Date(intake.taken_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : routine.time,
    );
  }

  async function authenticate(
    e: FormEvent<HTMLFormElement>,
    mode: typeof authMode,
  ) {
    e.preventDefault();
    setAuthNotice("");
    const d = new FormData(e.currentTarget);
    setAuthBusy(true);
    try {
      const email = ["verify", "reset"].includes(mode) ? pendingAuthEmail : loginEmail(String(d.get("email") || ""));
      const password = String(d.get("password") || "");
      const otp = String(d.get("otp") || "").trim();
      const auth = getBackend().auth;
      if (mode === "recover") {
        const result = await getPasswordAuth().emailOtp.sendVerificationOtp({ email, type: "forget-password" });
        if (result.error) throw result.error;
        setPendingAuthEmail(email);
        setAuthMode("reset");
        setAuthNotice("Se a conta existir, um código será enviado ao e-mail informado.");
      } else if (mode === "reset") {
        const result = await getPasswordAuth().emailOtp.resetPassword({ email, otp, password });
        if (result.error) throw result.error;
        await auth.signOut();
        setAuthMode("login");
        setAuthNotice("Senha definida. Entre com a nova senha.");
      } else if (mode === "verify") {
        const result = await getPasswordAuth().emailOtp.verifyEmail({ email, otp });
        if (result.error) throw result.error;
        setAuthMode("login");
        setAuthNotice("E-mail confirmado. Entre com sua senha.");
        setAuthRefresh((value) => value + 1);
      } else {
        // O adaptador exige uma sessão no signUp; o cadastro com verificação
        // obrigatória usa a API nativa e só autentica após confirmar o e-mail.
        if (mode === "signup") {
          const result = await getPasswordAuth().signUp.email({ email, password, name: "" });
          if (result.error) throw result.error;
          setPendingAuthEmail(email);
          setAuthMode("verify");
          setAuthNotice("Conta criada. Informe o código de confirmação recebido por e-mail.");
          return;
        }
        const result = await auth.signInWithPassword({ email, password });
        if (result.error) {
          if (["EMAIL_NOT_VERIFIED", "email_not_confirmed"].includes(result.error.code || "")) {
            setPendingAuthEmail(email);
            setAuthMode("verify");
            setAuthNotice("Confirme seu e-mail com o código recebido. Você pode solicitar um novo código abaixo.");
            return;
          }
          throw result.error;
        }
        // O adaptador beta não emite todas as mudanças na própria aba.
        setAuthRefresh((value) => value + 1);
      }
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Não foi possível concluir. Confira os dados e tente novamente.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendVerification() {
    setAuthBusy(true);
    try {
      const result = await getPasswordAuth().emailOtp.sendVerificationOtp({ email: pendingAuthEmail, type: "email-verification" });
      if (result.error) throw result.error;
      setAuthNotice("Um novo código de confirmação foi solicitado.");
    } catch {
      setAuthNotice("Não foi possível reenviar o código. Aguarde e tente novamente.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const { error } = await getBackend().auth.signOut();
    if (error) setNotice("Não foi possível sair. Tente novamente.");
    else setAuthRefresh((value) => value + 1);
  }

  async function addMedicine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (viewerMutationBlocked()) return;
    const d = new FormData(e.currentTarget);
    if (!user) return;
    const payload = {
      user_id: user.id,
      name: String(d.get("medicineName")),
      dosage: String(d.get("dosage")),
      reference_url: String(d.get("link") || "") || null,
    };
    const { data, error } = await getBackend()
      .from("medications")
      .insert(payload)
      .select("id,name,dosage,reference_url")
      .single();
    if (error) {
      setNotice("Erro ao salvar medicamento: " + error.message);
      return;
    }
    setMedicines((list) => [
      ...list,
      {
        id: data.id,
        name: data.name,
        dosage: data.dosage,
        link: data.reference_url || "",
      },
    ]);
    setMedicineOpen(false);
    setNotice(data.name + " foi salvo.");
  }

  function choosePrescription(file?: File) {
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
    setPrescriptionDrafts([]);
    setOcrProgress(0);
    setOcrNotice("");
    setIsTypedPrescription(false);
    if (!file) {
      setPrescriptionFile(null);
      setPrescriptionPreview("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPrescriptionFile(null);
      setPrescriptionPreview("");
      setOcrNotice("Selecione uma imagem JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPrescriptionFile(null);
      setPrescriptionPreview("");
      setOcrNotice("A imagem deve ter no máximo 10 MB.");
      return;
    }
    setPrescriptionFile(file);
    setPrescriptionPreview(URL.createObjectURL(file));
  }

  async function scanPrescription() {
    if (!prescriptionFile || !isTypedPrescription) return;
    setOcrReading(true);
    setOcrProgress(0);
    setOcrNotice("Preparando a leitura da receita…");
    try {
      const text = await readPrescriptionImage(prescriptionFile, (progress) => {
        setOcrProgress(progress);
        setOcrNotice(`Lendo a receita… ${progress}%`);
      });
      const drafts = parsePrescriptionText(text);
      setPrescriptionDrafts(drafts);
      setOcrNotice(
        drafts.length
          ? `${drafts.length} medicamento${drafts.length === 1 ? " encontrado" : "s encontrados"}. Confira todos os campos antes de salvar.`
          : "Não identificamos medicamentos automaticamente. Você pode adicionar as linhas manualmente.",
      );
    } catch (error) {
      console.error("Erro ao ler receita", error);
      setOcrNotice(
        "Não foi possível ler esta imagem. Confira sua conexão ou tente uma foto mais nítida.",
      );
    } finally {
      setOcrReading(false);
    }
  }

  function updatePrescriptionDraft(
    id: string,
    field: "name" | "dosage" | "link",
    value: string,
  ) {
    setPrescriptionDrafts((list) =>
      list.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    );
  }

  async function savePrescriptionMedicines() {
    if (viewerMutationBlocked()) return;
    if (!user || bulkSaving) return;
    const validDrafts = prescriptionDrafts.filter(
      (item) => item.name.trim() && item.dosage.trim(),
    );
    if (!validDrafts.length) {
      setOcrNotice("Preencha o nome e a dosagem de pelo menos um medicamento.");
      return;
    }
    setBulkSaving(true);
    const { data, error } = await getBackend()
      .from("medications")
      .insert(
        validDrafts.map((item) => ({
          user_id: user.id,
          name: item.name.trim(),
          dosage: item.dosage.trim(),
          reference_url: item.link.trim() || null,
        })),
      )
      .select("id,name,dosage,reference_url");
    setBulkSaving(false);
    if (error) {
      setOcrNotice("Erro ao salvar medicamentos: " + error.message);
      return;
    }
    setMedicines((list) => [
      ...list,
      ...(data || []).map((item) => ({
        id: item.id,
        name: item.name,
        dosage: item.dosage,
        link: item.reference_url || "",
      })),
    ]);
    setPrescriptionOpen(false);
    setPrescriptionDrafts([]);
    setPrescriptionFile(null);
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
    setPrescriptionPreview("");
    setNotice(
      `${validDrafts.length} medicamento${validDrafts.length === 1 ? " foi cadastrado" : "s foram cadastrados"} após sua confirmação.`,
    );
  }
  function openNewRoutine() {
    if (viewerMutationBlocked()) return;
    setEditingRoutine(null);
    setRoutineError("");
    setSelected([]);
    setRoutineDoses({});
    setFrequencyKind("daily");
    setMedicineToAdd("");
    setNoEndDate(false);
    setRoutineOpen(true);
  }
  function openEditRoutine(routine: Routine) {
    if (viewerMutationBlocked()) return;
    setEditingRoutine(routine);
    setRoutineError("");
    setSelected([...routine.medicineIds]);
    setRoutineDoses({...routine.doses});
    setFrequencyKind(routine.frequencyKind || "daily");
    setMedicineToAdd("");
    setNoEndDate(routine.noEndDate);
    setRoutineOpen(true);
  }
  async function saveRoutine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (viewerMutationBlocked()) return;
    const d = new FormData(e.currentTarget);
    const name = String(d.get("routineName"));
    if (!user) return;
    const durationValue = noEndDate ? null : Number(d.get("durationValue"));
    const durationUnit = noEndDate
      ? null
      : (String(d.get("durationUnit") || "days") as "days" | "weeks");
    const totalDays = noEndDate
      ? null
      : durationUnit === "weeks"
        ? Number(durationValue) * 7
        : Number(durationValue);
    const payload = {
      user_id: user.id,
      name,
      period_description: String(d.get("period")),
      has_no_end_date: noEndDate,
      duration_value: durationValue,
      duration_unit: durationUnit,
      total_days: totalDays,
      scheduled_time: String(d.get("time")),
      deadline_time: String(d.get("limit")),
      status: editingRoutine
        ? editingRoutine.paused
          ? "paused"
          : "active"
        : "active",
    };
    if (routineSaveLock.current) return;
    setRoutineError("");
    let doses;
    try {
      doses=selected.map(id=>{
        const dose=routineDoses[id]; const quantity=parseQuantity(dose?.quantity || "",true);
        if (quantity===null) throw new Error("Informe a quantidade de cada medicamento por tomada.");
        return {medication_id:id,quantity,unit:dose.unit};
      });
    } catch(error) {setRoutineError(error instanceof Error ? error.message : "Confira as quantidades.");return;}
    routineSaveLock.current=true;setRoutineSaving(true);
    const revision=authRevision.current;
    const intent=JSON.stringify({routine:editingRoutine?.id,...payload,frequencyKind,doses});
    if(routineSaveCommand.current?.payload!==intent) routineSaveCommand.current={payload:intent,id:crypto.randomUUID()};
    try {
      const {error}=await getBackend().rpc("save_routine_with_doses",{p_routine_id:editingRoutine?.id || null,p_definition:{...payload,frequency_kind:frequencyKind,command_id:routineSaveCommand.current.id},p_doses:doses});
      if (revision!==authRevision.current) return;
      if (error) {setRoutineError("Erro ao salvar rotina: "+error.message);return;}
      routineSaveCommand.current=null;
      setRoutineOpen(false);setEditingRoutine(null);setSelected([]);setRoutineDoses({});
      setInventoryRevision(v=>v+1);
      await loadData();
      setNotice("Rotina salva com as quantidades por tomada. As próximas confirmações atualizarão o estoque.");
    } catch {if(revision===authRevision.current) setRoutineError("Conexão interrompida. Tente salvar novamente; a operação será consultada sem criar uma rotina duplicada.");}
    finally {routineSaveLock.current=false;setRoutineSaving(false);}
  }
  function addSelectedMedicine() {
    if (viewerMutationBlocked()) return;
    const id = medicineToAdd;
    if (!id || selected.includes(id)) return;
    setSelected((list) => [...list, id]);
    setRoutineDoses(current=>({...current,[id]:{quantity:"",unit:"tablet"}}));
    setMedicineToAdd("");
  }
  function removeSelectedMedicine(id: string) {
    if (viewerMutationBlocked()) return;
    setSelected((list) => list.filter((item) => item !== id));
  }
  async function changeIntake(routine:Routine,action:"confirm"|"undo"|"correct",date:string,intake?:Intake,at?:string) {
    if (viewerMutationBlocked() || !user || intakeLock.current) return false;
    if (action==="confirm" && !routine.stockTracking) {
      openEditRoutine(routine);setNotice("Informe a quantidade de cada medicamento e salve a rotina antes de confirmar a tomada.");return false;
    }
    const key=[user.authId,routine.id,action,date,intake?.id || "",at || ""].join(":");
    let command=intakeCommands.current.get(key);
    if (!command) {
      const now=new Date();
      command={id:crypto.randomUUID(),at:at || new Date(`${date}T${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`).toISOString()};
      intakeCommands.current.set(key,command);
    }
    intakeLock.current=true;setIntakeBusy(true);
    const revision=authRevision.current;
    try {
      const {error}=await getBackend().rpc("change_routine_intake",{p_command:command.id,p_routine_id:routine.id,p_action:action,p_taken_at:command.at,p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,p_intake_id:intake?.id || null});
      if (revision!==authRevision.current) return false;
      if (error) {setNotice("Não foi possível atualizar a tomada: "+error.message);return false;}
      intakeCommands.current.delete(key);
      setInventoryRevision(v=>v+1);
      return true;
    } catch {if(revision===authRevision.current) setNotice("Conexão interrompida. Tente novamente para consultar a mesma operação, sem duplicar a baixa.");return false;}
    finally {intakeLock.current=false;setIntakeBusy(false);}
  }
  async function toggleTaken(id: string) {
    const routine=routines.find(r=>r.id===id);
    if (!routine) return;
    const intake=routine.intakeId && routine.takenAt ? {id:routine.intakeId,routine_id:id,taken_at:routine.takenAt} : undefined;
    if (!await changeIntake(routine,routine.taken ? "undo" : "confirm",localDateKey(new Date()),intake)) return;
    await loadData();
    setNotice(routine.taken ? "Conclusão desfeita e baixa original estornada." : "Tomada registrada. O estoque foi atualizado conforme as quantidades da rotina.");
  }
  function saveWhatsAppSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (viewerMutationBlocked()) return;
    const d = new FormData(e.currentTarget);
    const phone = String(d.get("whatsAppPhone") || "").replace(/\D/g, "");
    setWhatsAppPhone(phone);
    localStorage.setItem("medication-whatsapp-phone", phone);
    localStorage.setItem(
      "medication-whatsapp-medicines",
      String(includeMedicineNames),
    );
    setWhatsAppOpen(false);
    setNotice("Número do WhatsApp salvo neste dispositivo.");
  }
  function sendWhatsApp(routine: Routine) {
    if (viewerMutationBlocked()) return;
    if (!whatsAppPhone) {
      setWhatsAppOpen(true);
      setNotice("Cadastre o número que receberá a confirmação.");
      return;
    }
    const names = medicineNames(routine.medicineIds);
    if (!routine.takenAt) {
      setNotice("Não foi possível localizar o horário registrado da rotina.");
      return;
    }
    const registeredTime = new Date(routine.takenAt).toLocaleTimeString(
      "pt-BR",
      { hour: "2-digit", minute: "2-digit" },
    );
    const lines = [
      "Rotina concluída ✅",
      `Rotina: ${routine.name}`,
      `Horário registrado: ${registeredTime}`,
      routine.noEndDate
        ? "Rotina contínua — sem data para terminar"
        : `Dia ${routine.currentDay} de ${routine.totalDays}`,
    ];
    if (includeMedicineNames && names.length)
      lines.splice(2, 0, `Medicamentos: ${names.join(", ")}`);
    window.open(
      `https://wa.me/${whatsAppPhone}?text=${encodeURIComponent(lines.join("\n"))}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  async function togglePause(id: string) {
    if (viewerMutationBlocked()) return;
    const routine = routines.find((r) => r.id === id);
    if (!routine) return;
    const paused = !routine.paused;
    const { error } = await getBackend()
      .from("medication_routines")
      .update({
        status: paused ? "paused" : "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      setNotice("Erro ao atualizar rotina: " + error.message);
      return;
    }
    setRoutines((list) =>
      list.map((r) => (r.id === id ? { ...r, paused } : r)),
    );
    setInventoryRevision(v=>v+1);
  }
  async function remove(id: string) {
    if (viewerMutationBlocked()) return;
    const {error}=await getBackend().rpc("archive_medication_routine",{p_routine_id:id});
    if (error) {setNotice("Erro ao arquivar rotina: "+error.message);return;}
    await loadData();setInventoryRevision(v=>v+1);
    setNotice("Rotina arquivada. As tomadas e movimentações anteriores foram preservadas.");
  }

  if (authLoading)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8fc]">
        <p className="font-semibold text-slate-500">Conectando à sua conta…</p>
      </main>
    );
  if (!user)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8fc] p-4 text-slate-950">
        <Card className="w-full max-w-md rounded-3xl shadow-xl shadow-blue-100/60">
          <CardContent className="p-7 sm:p-8">
            <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-blue-600 text-white">
              <Pill />
            </div>
            <h1 className="text-2xl font-extrabold">Minha medicação</h1>
            <p className="mt-2 text-sm text-slate-500">
              Entre para manter seus medicamentos e rotinas salvos com
              segurança.
            </p>
            <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAuthMode("login")}
                className={authMode === "login" ? "bg-white shadow-sm" : ""}
              >
                Entrar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAuthMode("signup")}
                className={authMode === "signup" ? "bg-white shadow-sm" : ""}
              >
                Criar conta
              </Button>
            </div>
            <form
              onSubmit={(e) => authenticate(e, authMode)}
              className="mt-5 grid gap-4"
            >
              {!["verify", "reset"].includes(authMode) && <Field
                id="email"
                label={authMode === "login" ? "Usuário ou e-mail" : "E-mail"}
                type={authMode === "login" ? "text" : "email"}
                placeholder={
                  authMode === "login" ? "Seu usuário ou e-mail" : "seu@email.com"
                }
              />}
              {["verify", "reset"].includes(authMode) && <>
                <p className="text-sm text-slate-600">Código enviado para {pendingAuthEmail}</p>
                <Field id="otp" label="Código do e-mail" placeholder="Código de confirmação" />
              </>}
              {["login", "signup", "reset"].includes(authMode) && <Field
                id="password"
                label={authMode === "reset" ? "Nova senha" : "Senha"}
                type="password"
                placeholder="Mínimo de 8 caracteres"
              />}
              <Button disabled={authBusy} className="mt-1 h-12 rounded-xl bg-blue-600">
                {authBusy ? "Aguarde…" : { login: "Entrar no sistema", signup: "Criar conta", verify: "Confirmar e-mail", recover: "Enviar código", reset: "Definir nova senha" }[authMode]}
              </Button>
            </form>
            {authMode === "verify" && <Button type="button" variant="ghost" disabled={authBusy} onClick={resendVerification}>Reenviar código</Button>}
            <Button type="button" variant="ghost" disabled={authBusy} className="mt-2" onClick={() => { setAuthNotice(""); setAuthMode(authMode === "recover" || authMode === "reset" || authMode === "verify" ? "login" : "recover"); }}>
              {["recover", "reset", "verify"].includes(authMode) ? "Voltar para entrar" : "Primeiro acesso ou esqueci a senha"}
            </Button>
            {authNotice && (
              <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-medium text-blue-800">
                {authNotice}
              </p>
            )}
            <p className="mt-5 text-xs leading-5 text-slate-400">
              Os dados ficam vinculados à sua conta e protegidos pelas regras de
              acesso da aplicação.
            </p>
          </CardContent>
        </Card>
      </main>
    );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8fc] text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white">
              <Pill />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">Minha medicação</p>
              <p className="truncate text-sm text-slate-500">
                Rotinas e medicamentos
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="shrink-0 sm:hidden"
              aria-label="Sair da conta"
            >
              <LogOut />
            </Button>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="hidden sm:inline-flex"
              aria-label="Sair da conta"
            >
              <LogOut />
            </Button>
            <Dialog open={whatsAppOpen} onOpenChange={setWhatsAppOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isViewer}
                  title={isViewer ? "Disponível apenas para edição" : undefined}
                  className="h-11 min-w-0 rounded-xl bg-white px-3"
                >
                  <MessageCircle /> WhatsApp
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-lg sm:p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl sm:text-2xl">
                    Configurar WhatsApp
                  </DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={saveWhatsAppSettings}
                  className="mt-2 grid min-w-0 grid-cols-1 gap-5"
                >
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="whatsAppPhone">Número destinatário</Label>
                    <Input
                      id="whatsAppPhone"
                      name="whatsAppPhone"
                      type="tel"
                      inputMode="numeric"
                      defaultValue={whatsAppPhone}
                      placeholder="Ex.: 5511999999999"
                      required
                    />
                    <p className="text-sm text-slate-500">
                      Informe código do país, DDD e número. Use somente números.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4">
                    <Checkbox
                      checked={includeMedicineNames}
                      onCheckedChange={(value) =>
                        setIncludeMedicineNames(value === true)
                      }
                    />
                    <span>
                      <strong className="block text-sm">
                        Incluir medicamentos na mensagem
                      </strong>
                      <span className="mt-1 block text-sm text-slate-500">
                        Desative para enviar apenas o nome da rotina e o
                        horário.
                      </span>
                    </span>
                  </label>
                  <Button className="h-12 rounded-xl bg-blue-600">
                    Salvar configuração
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={reportOpen} onOpenChange={handleReportOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 min-w-0 rounded-xl bg-white px-3"
                >
                  <CalendarDays /> Relatório
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:rounded-3xl sm:p-6 lg:max-w-6xl">
                <DialogHeader>
                  <DialogTitle className="text-xl sm:text-2xl">
                    Relatório diário
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-2 grid min-w-0 grid-cols-1 gap-5">
                  <div className="grid gap-2 sm:max-w-xs">
                    <Label htmlFor="reportDate">Data do relatório</Label>
                    <Input
                      id="reportDate"
                      type="date"
                      value={reportDate}
                      max={localDateKey(new Date())}
                      onChange={(event) => {
                        const value = event.target.value;
                        setReportDate(value);
                        setEditingReportRoutineId(null);
                        if (value) void loadReport(value);
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-3">
                    <ReportCount
                      label="Tomados"
                      value={reportTaken}
                      tone="green"
                    />
                    <ReportCount
                      label="Pendentes"
                      value={reportPending}
                      tone="blue"
                    />
                    <ReportCount
                      label="Não tomados"
                      value={reportMissed}
                      tone="red"
                    />
                  </div>

                  <p className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-800">
                    Uma rotina só recebe o status “Não tomado” depois da
                    meia-noite. Durante o próprio dia, ela permanece como
                    “Pendente” até ser concluída.
                  </p>

                  {reportLoading ? (
                    <p className="py-8 text-center font-medium text-slate-500">
                      Gerando relatório…
                    </p>
                  ) : reportRows.length === 0 ? (
                    <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">
                      Nenhuma rotina ativa para exibir neste relatório.
                    </p>
                  ) : (
                    <div className="grid gap-3">
                      {reportRows.map(({ routine, intake, status }) => (
                        <div
                          key={routine.id}
                          className="grid gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900">
                              {routine.name}
                            </p>
                            <div className="mt-2 grid gap-1 text-sm text-slate-600">
                              {routine.medicineIds.map((id) => {
                                const medicine = medicines.find(
                                  (item) => item.id === id,
                                );
                                return medicine ? (
                                  <p key={id}>
                                    {medicine.name} — {medicine.dosage}
                                  </p>
                                ) : null;
                              })}
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                              Previsto para {routine.time}
                            </p>
                          </div>
                          <div className="grid justify-items-start gap-2 sm:justify-items-end">
                            <ReportStatus
                              status={status}
                              takenAt={intake?.taken_at}
                            />
                            {editingReportRoutineId !== routine.id && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={isViewer}
                                onClick={() => {
                                  setEditingReportRoutineId(routine.id);
                                  setCorrectedDate(
                                    intake
                                      ? localDateKey(new Date(intake.taken_at))
                                      : reportDate,
                                  );
                                  setCorrectedTime(
                                    intake
                                      ? new Date(
                                          intake.taken_at,
                                        ).toLocaleTimeString("pt-BR", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : routine.time,
                                  );
                                }}
                                className="rounded-xl text-blue-700"
                              >
                                <Pencil className="size-4" />
                                {intake
                                  ? "Editar registro"
                                  : "Registrar tomada"}
                              </Button>
                            )}
                            {editingReportRoutineId === routine.id && (
                              <div className="grid w-full gap-2 rounded-2xl bg-slate-50 p-3 sm:w-auto">
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Data</Label>
                                    <Input
                                      type="date"
                                      value={correctedDate}
                                      max={localDateKey(new Date())}
                                      onChange={(event) =>
                                        setCorrectedDate(event.target.value)
                                      }
                                      className="h-10 rounded-xl"
                                      aria-label="Nova data da tomada"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Horário</Label>
                                    <Input
                                      type="time"
                                      value={correctedTime}
                                      onChange={(event) =>
                                        setCorrectedTime(event.target.value)
                                      }
                                      className="h-10 rounded-xl"
                                      aria-label="Novo horário da tomada"
                                    />
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() =>
                                      void saveReportRecord(routine, intake)
                                    }
                                    disabled={!correctedDate || !correctedTime}
                                    className="rounded-xl bg-blue-600"
                                  >
                                    {intake ? "Salvar alteração" : "Registrar"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setEditingReportRoutineId(null)
                                    }
                                    className="rounded-xl"
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <section className="mt-3 min-w-0 border-t border-slate-200 pt-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          Histórico completo
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Altere o status diretamente no histórico. Ao marcar
                          como tomado, será registrado o horário real da ação.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <div className="grid gap-1">
                          <Label className="text-xs" htmlFor="historyStart">
                            Data inicial
                          </Label>
                          <Input
                            id="historyStart"
                            type="date"
                            value={historyStart}
                            max={historyEnd}
                            onChange={(event) =>
                              setHistoryStart(event.target.value)
                            }
                            className="h-10 rounded-xl"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs" htmlFor="historyEnd">
                            Data final
                          </Label>
                          <Input
                            id="historyEnd"
                            type="date"
                            value={historyEnd}
                            min={historyStart}
                            max={localDateKey(new Date())}
                            onChange={(event) =>
                              setHistoryEnd(event.target.value)
                            }
                            className="h-10 rounded-xl"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void loadHistory()}
                          disabled={!historyStart || !historyEnd}
                          className="h-10 self-end rounded-xl"
                        >
                          Atualizar
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:hidden">
                      {historyLoading ? (
                        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center font-medium text-slate-500">
                          Carregando histórico…
                        </p>
                      ) : historyRows.length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500">
                          Nenhum dia encontrado no período.
                        </p>
                      ) : (
                        historyRows.map(({ date, routine, intake, status }) => (
                          <article
                            key={`mobile-${date}-${routine.id}`}
                            className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="flex min-w-0 items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-blue-700">
                                  {formatDateKey(date)}
                                </p>
                                <h4 className="mt-1 break-words font-extrabold text-slate-900">
                                  {routine.name}
                                </h4>
                              </div>
                              <ReportStatus
                                status={status}
                                takenAt={intake?.taken_at}
                                compact
                              />
                            </div>

                            <div className="mt-3 grid min-w-0 gap-1.5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                              {routine.medicineIds.map((id) => {
                                const medicine = medicines.find(
                                  (item) => item.id === id,
                                );
                                return medicine ? (
                                  <span key={id} className="break-words">
                                    {medicine.name} — {medicine.dosage}
                                  </span>
                                ) : null;
                              })}
                            </div>

                            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <dt className="font-semibold text-slate-500">
                                  Previsto
                                </dt>
                                <dd className="mt-1 font-bold text-slate-900">
                                  {routine.time}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-slate-500">
                                  Tomado às
                                </dt>
                                <dd className="mt-1 font-bold text-slate-900">
                                  {intake
                                    ? new Date(
                                        intake.taken_at,
                                      ).toLocaleTimeString("pt-BR", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "—"}
                                </dd>
                              </div>
                            </dl>

                            <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 font-semibold text-slate-700">
                              <Checkbox
                                checked={Boolean(intake)}
                                onCheckedChange={() =>
                                  void toggleHistoryTaken(
                                    routine,
                                    date,
                                    intake,
                                  )
                                }
                                aria-label={`Alterar ${routine.name} em ${formatDateKey(date)}`}
                              />
                              Marcar como tomado
                            </label>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                beginEditingRecord(
                                  routine,
                                  intake,
                                  date,
                                  `history-${date}-${routine.id}`,
                                )
                              }
                              className="mt-2 h-11 w-full rounded-xl"
                            >
                              <Pencil className="size-4" />
                              Editar registro
                            </Button>
                            {editingReportRoutineId ===
                              `history-${date}-${routine.id}` && (
                              <div className="mt-3 grid gap-3 rounded-2xl bg-slate-50 p-3">
                                <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Data</Label>
                                    <Input
                                      type="date"
                                      value={correctedDate}
                                      max={localDateKey(new Date())}
                                      onChange={(event) =>
                                        setCorrectedDate(event.target.value)
                                      }
                                      className="h-10 rounded-xl"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Horário</Label>
                                    <Input
                                      type="time"
                                      value={correctedTime}
                                      onChange={(event) =>
                                        setCorrectedTime(event.target.value)
                                      }
                                      className="h-10 rounded-xl"
                                    />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() =>
                                      void saveReportRecord(routine, intake)
                                    }
                                    disabled={!correctedDate || !correctedTime}
                                    className="rounded-xl bg-blue-600"
                                  >
                                    Salvar
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setEditingReportRoutineId(null)
                                    }
                                    className="rounded-xl"
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </article>
                        ))
                      )}
                    </div>

                    <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
                      <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3 font-bold">Data</th>
                            <th className="px-4 py-3 font-bold">Rotina</th>
                            <th className="px-4 py-3 font-bold">
                              Medicamentos e dosagens
                            </th>
                            <th className="px-4 py-3 font-bold">Previsto</th>
                            <th className="px-4 py-3 font-bold">Tomado às</th>
                            <th className="px-4 py-3 font-bold">Status</th>
                            <th className="px-4 py-3 font-bold">Alterar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {historyLoading ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-4 py-8 text-center font-medium text-slate-500"
                              >
                                Carregando histórico…
                              </td>
                            </tr>
                          ) : historyRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-4 py-8 text-center text-slate-500"
                              >
                                Nenhum dia encontrado no período.
                              </td>
                            </tr>
                          ) : (
                            historyRows.map(
                              ({ date, routine, intake, status }) => (
                                <tr
                                  key={`${date}-${routine.id}`}
                                  className="align-top hover:bg-slate-50/70"
                                >
                                  <td className="whitespace-nowrap px-4 py-4 font-bold text-slate-800">
                                    {formatDateKey(date)}
                                  </td>
                                  <td className="px-4 py-4 font-semibold text-slate-900">
                                    {routine.name}
                                  </td>
                                  <td className="px-4 py-4 text-slate-600">
                                    <div className="grid gap-1">
                                      {routine.medicineIds.map((id) => {
                                        const medicine = medicines.find(
                                          (item) => item.id === id,
                                        );
                                        return medicine ? (
                                          <span key={id}>
                                            {medicine.name} — {medicine.dosage}
                                          </span>
                                        ) : null;
                                      })}
                                    </div>
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 font-medium">
                                    {routine.time}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {intake
                                      ? new Date(
                                          intake.taken_at,
                                        ).toLocaleTimeString("pt-BR", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-4">
                                    <ReportStatus
                                      status={status}
                                      takenAt={intake?.taken_at}
                                      compact
                                    />
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="grid gap-2">
                                      <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700">
                                        <Checkbox
                                          checked={Boolean(intake)}
                                          onCheckedChange={() =>
                                            void toggleHistoryTaken(
                                              routine,
                                              date,
                                              intake,
                                            )
                                          }
                                          aria-label={`Alterar ${routine.name} em ${formatDateKey(date)}`}
                                        />
                                        Tomado
                                      </label>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          beginEditingRecord(
                                            routine,
                                            intake,
                                            date,
                                            `history-${date}-${routine.id}`,
                                          )
                                        }
                                        className="w-fit rounded-xl px-2 text-blue-700"
                                      >
                                        <Pencil className="size-4" />
                                        Editar registro
                                      </Button>
                                      {editingReportRoutineId ===
                                        `history-${date}-${routine.id}` && (
                                        <div className="grid min-w-56 gap-2 rounded-xl bg-slate-50 p-3">
                                          <div className="grid gap-1">
                                            <Label className="text-xs">
                                              Data
                                            </Label>
                                            <Input
                                              type="date"
                                              value={correctedDate}
                                              max={localDateKey(new Date())}
                                              onChange={(event) =>
                                                setCorrectedDate(
                                                  event.target.value,
                                                )
                                              }
                                              className="h-9 rounded-lg"
                                            />
                                          </div>
                                          <div className="grid gap-1">
                                            <Label className="text-xs">
                                              Horário
                                            </Label>
                                            <Input
                                              type="time"
                                              value={correctedTime}
                                              onChange={(event) =>
                                                setCorrectedTime(
                                                  event.target.value,
                                                )
                                              }
                                              className="h-9 rounded-lg"
                                            />
                                          </div>
                                          <div className="flex gap-2">
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={() =>
                                                void saveReportRecord(
                                                  routine,
                                                  intake,
                                                )
                                              }
                                              disabled={
                                                !correctedDate ||
                                                !correctedTime
                                              }
                                              className="rounded-lg bg-blue-600"
                                            >
                                              Salvar
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              onClick={() =>
                                                setEditingReportRoutineId(null)
                                              }
                                              className="rounded-lg"
                                            >
                                              Cancelar
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ),
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={medicineOpen} onOpenChange={setMedicineOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isViewer}
                  title={isViewer ? "Perfil somente leitura" : undefined}
                  className="h-11 min-w-0 rounded-xl bg-white px-3"
                >
                  <Pill /> Medicamento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-lg sm:p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl sm:text-2xl">
                    Cadastrar medicamento
                  </DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={addMedicine}
                  className="mt-2 grid min-w-0 grid-cols-1 gap-5"
                >
                  <Field
                    id="medicineName"
                    label="Nome"
                    placeholder="Ex.: Metilcobalamina"
                  />
                  <Field
                    id="dosage"
                    label="Dosagem"
                    placeholder="Ex.: 1.000 mcg • 1 cápsula"
                  />
                  <Field
                    id="link"
                    label="Link de referência"
                    type="url"
                    placeholder="https://..."
                    optional
                  />
                  <Button className="h-12 rounded-xl bg-blue-600">
                    Salvar medicamento
                  </Button>
                </form>
                <div className="mt-5 border-t border-slate-200 pt-5">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMedicineOpen(false);
                      setPrescriptionOpen(true);
                    }}
                    className="h-12 w-full rounded-xl border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    <FileImage /> Importar medicamentos da receita
                  </Button>
                  <p className="mt-2 text-center text-xs leading-5 text-slate-500">
                    Para receitas digitadas ou impressas. A imagem será lida no
                    seu aparelho e não será armazenada.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={prescriptionOpen} onOpenChange={setPrescriptionOpen}>
              <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto rounded-3xl p-4 sm:max-w-4xl sm:p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl sm:text-2xl">
                    Importar receita
                  </DialogTitle>
                </DialogHeader>

                <div className="mt-2 grid gap-5">
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                    <strong className="block">
                      Somente receitas digitadas ou impressas
                    </strong>
                    Receitas manuscritas não serão processadas. Mesmo em textos
                    digitados, o OCR pode trocar nomes, unidades ou números;
                    compare cada item com a receita original.
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="grid content-start gap-3">
                      <Label
                        htmlFor="prescriptionImage"
                        className="grid min-h-44 cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:border-blue-400 hover:bg-blue-50"
                      >
                        {prescriptionPreview ? (
                          <img
                            src={prescriptionPreview}
                            alt="Prévia da receita selecionada"
                            className="max-h-64 w-full rounded-xl object-contain"
                          />
                        ) : (
                          <>
                            <span className="grid size-12 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                              <Upload />
                            </span>
                            <span>
                              <strong className="block text-slate-900">
                                Fotografar ou selecionar receita
                              </strong>
                              <span className="mt-1 block text-sm font-normal text-slate-500">
                                JPG, PNG ou WEBP, até 10 MB
                              </span>
                            </span>
                          </>
                        )}
                      </Label>
                      <Input
                        id="prescriptionImage"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        onChange={(event) =>
                          choosePrescription(event.target.files?.[0])
                        }
                        className="sr-only"
                      />
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                        <Checkbox
                          checked={isTypedPrescription}
                          onCheckedChange={(value) =>
                            setIsTypedPrescription(value === true)
                          }
                        />
                        <span>
                          <strong className="block text-sm text-slate-900">
                            Confirmo que esta receita é digitada ou impressa
                          </strong>
                          <span className="mt-1 block text-sm leading-5 text-slate-500">
                            Não utilize este leitor para receitas preenchidas à
                            mão.
                          </span>
                        </span>
                      </label>
                      <Button
                        type="button"
                        onClick={() => void scanPrescription()}
                        disabled={
                          !prescriptionFile ||
                          !isTypedPrescription ||
                          ocrReading
                        }
                        className="h-12 rounded-xl bg-blue-600"
                      >
                        {ocrReading ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <FileImage />
                        )}
                        {ocrReading ? "Lendo receita…" : "Ler receita"}
                      </Button>
                      {ocrReading && (
                        <Progress value={ocrProgress} className="h-2" />
                      )}
                      {ocrNotice && (
                        <p
                          className="rounded-xl bg-slate-100 p-3 text-sm leading-5 text-slate-700"
                          role="status"
                        >
                          {ocrNotice}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-extrabold text-slate-900">
                            Medicamentos identificados
                          </h3>
                          <p className="text-sm text-slate-500">
                            Edite ou exclua qualquer item antes de confirmar.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setPrescriptionDrafts((list) => [
                              ...list,
                              emptyPrescriptionDraft(),
                            ])
                          }
                          className="rounded-xl"
                        >
                          <Plus /> Adicionar linha
                        </Button>
                      </div>

                      {prescriptionDrafts.length === 0 ? (
                        <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                          Os campos preenchidos aparecerão aqui depois da
                          leitura. Nada será cadastrado automaticamente.
                        </div>
                      ) : (
                        <div className="grid max-h-[50dvh] gap-3 overflow-y-auto pr-1">
                          {prescriptionDrafts.map((item, index) => (
                            <div
                              key={item.id}
                              className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <strong className="text-sm text-slate-700">
                                  Medicamento {index + 1}
                                </strong>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setPrescriptionDrafts((list) =>
                                      list.filter(
                                        (draft) => draft.id !== item.id,
                                      ),
                                    )
                                  }
                                  className="size-9 rounded-xl text-red-600"
                                  aria-label={`Excluir medicamento ${index + 1}`}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`ocr-name-${item.id}`}>
                                    Nome
                                  </Label>
                                  <Input
                                    id={`ocr-name-${item.id}`}
                                    value={item.name}
                                    onChange={(event) =>
                                      updatePrescriptionDraft(
                                        item.id,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Nome do medicamento"
                                  />
                                </div>
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`ocr-dose-${item.id}`}>
                                    Dosagem e orientação
                                  </Label>
                                  <Input
                                    id={`ocr-dose-${item.id}`}
                                    value={item.dosage}
                                    onChange={(event) =>
                                      updatePrescriptionDraft(
                                        item.id,
                                        "dosage",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Ex.: 500 mg • 1 vez ao dia"
                                  />
                                </div>
                              </div>
                              <div className="grid gap-1.5">
                                <Label htmlFor={`ocr-link-${item.id}`}>
                                  Link de referência (opcional)
                                </Label>
                                <Input
                                  id={`ocr-link-${item.id}`}
                                  type="url"
                                  value={item.link}
                                  onChange={(event) =>
                                    updatePrescriptionDraft(
                                      item.id,
                                      "link",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="https://..."
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setPrescriptionOpen(false)}
                      className="h-11 rounded-xl"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void savePrescriptionMedicines()}
                      disabled={
                        bulkSaving ||
                        !prescriptionDrafts.some(
                          (item) => item.name.trim() && item.dosage.trim(),
                        )
                      }
                      className="h-11 rounded-xl bg-blue-600"
                    >
                      {bulkSaving && <LoaderCircle className="animate-spin" />}
                      Confirmar e cadastrar {prescriptionDrafts.length || ""}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={routineOpen} onOpenChange={open=>{if(!routineSaveLock.current) setRoutineOpen(open);}}>
              <DialogTrigger asChild>
                <Button
                  onClick={openNewRoutine}
                  disabled={isViewer}
                  title={isViewer ? "Perfil somente leitura" : undefined}
                  className="col-span-2 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 sm:col-span-1"
                >
                  <Plus /> Nova rotina
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-xl sm:p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl sm:text-2xl">
                    {editingRoutine ? "Alterar rotina" : "Criar rotina"}
                  </DialogTitle>
                </DialogHeader>
                <form
                  key={editingRoutine?.id || "new"}
                  onSubmit={saveRoutine}
                  className="mt-2 grid min-w-0 grid-cols-1 gap-5"
                >
                  <fieldset disabled={routineSaving} className="contents">
                  <Field
                    id="routineName"
                    label="Nome da rotina"
                    placeholder="Ex.: Rotina da manhã"
                    value={editingRoutine?.name}
                  />
                  <div className="grid gap-2">
                    <Label>Medicamentos</Label>
                    <p className="text-sm text-slate-500">
                      Escolha um medicamento da lista e clique em “+” para
                      adicionar.
                    </p>
                    <div className="mt-1 flex min-w-0 gap-2">
                      <Select
                        value={medicineToAdd}
                        onValueChange={setMedicineToAdd}
                      >
                        <SelectTrigger
                          className="h-12 min-w-0 flex-1 rounded-xl"
                          aria-label="Selecionar medicamento"
                        >
                          <SelectValue placeholder="Selecione um medicamento" />
                        </SelectTrigger>
                        <SelectContent>
                          {medicines
                            .filter((m) => !selected.includes(m.id))
                            .map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.name} — {m.dosage}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="icon"
                        onClick={addSelectedMedicine}
                        disabled={!medicineToAdd}
                        className="size-12 shrink-0 rounded-xl bg-blue-600"
                        aria-label="Adicionar medicamento à rotina"
                      >
                        <Plus className="size-5" />
                      </Button>
                    </div>
                    {selected.length > 0 && (
                      <div
                        className="mt-2 grid gap-2"
                        aria-label="Medicamentos adicionados"
                      >
                        {selected.map((id) => {
                          const medicine = medicines.find((m) => m.id === id);
                          return medicine ? (
                            <div
                              key={id}
                              className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3"
                            >
                              <Pill className="size-5 shrink-0 text-blue-600" />
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-sm">
                                  {medicine.name}
                                </strong>
                                <span className="block truncate text-sm text-slate-500">
                                  {medicine.dosage}
                                </span>
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeSelectedMedicine(id)}
                                className="shrink-0 rounded-xl text-slate-500 hover:text-red-600"
                                aria-label={`Remover ${medicine.name}`}
                              >
                                <X className="size-4" />
                              </Button>
                              <div className="grid w-full grid-cols-2 gap-3">
                                <div className="grid gap-2"><Label htmlFor={`dose-${id}`}>Quantidade por tomada</Label>
                                  <Input id={`dose-${id}`} aria-label={`Quantidade por tomada de ${medicine.name}`} type="number" inputMode="decimal" min="0.001" max="999999999.999" step="0.001" required value={routineDoses[id]?.quantity || ""} onChange={e=>setRoutineDoses(current=>({...current,[id]:{...current[id],quantity:e.target.value}}))} placeholder="Ex.: 2 ou 0,5" />
                                </div>
                                <div className="grid gap-2"><Label htmlFor={`dose-unit-${id}`}>Unidade</Label>
                                  <select id={`dose-unit-${id}`} aria-label={`Unidade de ${medicine.name}`} className="h-10 min-w-0 rounded-xl border bg-white px-2 text-sm" value={routineDoses[id]?.unit || "tablet"} onChange={e=>setRoutineDoses(current=>({...current,[id]:{...current[id],unit:e.target.value as QuantityUnit}}))}>
                                    <option value="tablet">Comprimidos</option><option value="ml">ml</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}
                    {medicines.length === 0 && (
                      <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                        Cadastre um medicamento antes de criar a rotina.
                      </p>
                    )}
                    {medicines.length > 0 &&
                      selected.length === medicines.length && (
                        <p className="text-sm font-medium text-blue-700">
                          Todos os medicamentos cadastrados foram adicionados.
                        </p>
                      )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id="time"
                      label="Horário"
                      type="time"
                      value={editingRoutine?.time || "08:00"}
                    />
                    <Field
                      id="limit"
                      label="Horário limite"
                      type="time"
                      value={editingRoutine?.limit || "09:00"}
                    />
                  </div>
                  <div className="grid gap-2"><Label htmlFor="frequency-kind">Repetição para a previsão de estoque</Label>
                    <select id="frequency-kind" className="h-11 w-full min-w-0 max-w-full rounded-xl border bg-white px-3" value={frequencyKind} onChange={e=>setFrequencyKind(e.target.value as "daily"|"other")}><option value="daily">Diária: uma tomada neste horário</option><option value="other">Outra frequência (sem previsão)</option></select>
                    <p className="text-xs leading-5 text-slate-500">Para tomar em vários horários, crie uma rotina para cada horário. As quantidades das rotinas diárias ativas serão somadas.</p>
                  </div>
                  <Field id="period" label="Orientação de frequência" placeholder="Ex.: Conforme orientação médica" value={editingRoutine?.period || "Todos os dias"} />
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <Checkbox
                      checked={noEndDate}
                      onCheckedChange={(value) => setNoEndDate(value === true)}
                    />
                    <span>
                      <strong className="block text-sm">
                        Esta rotina não tem data para terminar
                      </strong>
                      <span className="mt-1 block text-sm text-slate-500">
                        Use para medicamentos de uso contínuo.
                      </span>
                    </span>
                  </label>
                  <div
                    className={
                      "grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1.1fr] " +
                      (noEndDate ? "opacity-45" : "")
                    }
                  >
                    <Field
                      id="durationValue"
                      label="Período de uso"
                      type="number"
                      value={String(editingRoutine?.durationValue || 30)}
                      disabled={noEndDate}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="durationUnit">Unidade</Label>
                      <Select
                        key={editingRoutine?.id || "new-unit"}
                        name="durationUnit"
                        defaultValue={editingRoutine?.durationUnit || "days"}
                        disabled={noEndDate}
                      >
                        <SelectTrigger id="durationUnit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="days">Dias</SelectItem>
                          <SelectItem value="weeks">Semanas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    {noEndDate
                      ? "A rotina continuará ativa até ser pausada ou arquivada."
                      : "Exemplos: 30 dias ou 12 semanas."}
                  </p>
                  {routineError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{routineError}</p>}
                  <Button
                    disabled={selected.length === 0 || routineSaving}
                    className="h-12 rounded-xl bg-blue-600"
                  >
                    {routineSaving ? "Salvando…" : editingRoutine ? "Salvar alterações" : "Salvar rotina"}
                  </Button>
                  </fieldset>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
        {isViewer && (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
            Acesso como visualizador: todos os dados podem ser consultados, mas
            nenhuma alteração é permitida.
          </div>
        )}
        <section className="mb-7">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700">
            <CalendarDays className="size-4" /> TERÇA-FEIRA, 15 DE SETEMBRO
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
            Boa tarde, Joaquim
          </h1>
          <p className="mt-2 text-slate-500">
            Acompanhe suas rotinas e registre os horários.
          </p>
        </section>
        <section className="mb-8 grid gap-4 lg:grid-cols-[1.45fr_.8fr_.8fr]">
          <Card className="rounded-3xl border-0 bg-gradient-to-br from-blue-700 to-blue-600 text-white shadow-lg shadow-blue-100">
            <CardContent className="p-5 sm:p-7">
              <p className="text-sm font-semibold text-blue-100">
                Progresso de hoje
              </p>
              <p className="mt-1 text-4xl font-extrabold">
                {done} de {active.length}
              </p>
              <p className="mb-6 text-sm text-blue-100">rotinas concluídas</p>
              <Progress
                value={progress}
                className="h-2 bg-white/20 [&>div]:bg-white"
              />
            </CardContent>
          </Card>
          <Summary
            icon={<AlarmClock />}
            label="Próxima rotina"
            value={next?.time || "—"}
            note={next?.name || "Nenhuma pendência"}
          />
          <Summary
            icon={<BellRing />}
            label="Rotinas ativas"
            value={String(active.length)}
            note={medicines.length + " medicamentos cadastrados"}
          />
        </section>
        <MedicationInventory key={user.authId} medicines={medicines} user={user} dataLoading={dataLoading} revision={inventoryRevision} />
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-xl font-bold">Rotinas de hoje</h2>
            <p className="text-sm text-slate-500">
              Nome da rotina, medicamentos e horário.
            </p>
          </div>
          {routines.length > 0 && (
            <span className="shrink-0 rounded-full bg-blue-100 px-4 py-2 text-sm font-extrabold text-blue-700">
              {routines[0].noEndDate
                ? "Uso contínuo"
                : `Dia ${routines[0].currentDay}/${routines[0].totalDays}`}
            </span>
          )}
        </div>
        <section className="grid gap-4">
          {routines.length === 0 && (
            <Card className="rounded-3xl border-dashed border-slate-300 bg-white">
              <CardContent className="grid justify-items-center gap-3 p-10 text-center">
                <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                  <Pill />
                </div>
                <div>
                  <h3 className="font-bold">Nenhum medicamento cadastrado</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Cadastre um medicamento para começar a criar suas rotinas.
                  </p>
                </div>
                <Button
                  onClick={() => setMedicineOpen(true)}
                  disabled={isViewer}
                  variant="outline"
                  className="mt-2 rounded-xl"
                >
                  <Plus /> Cadastrar medicamento
                </Button>
              </CardContent>
            </Card>
          )}
          {routinesByTime.map((r) => (
            <Card
              key={r.id}
              className={
                "overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm " +
                (r.paused ? "opacity-65" : "")
              }
            >
              <CardContent className="p-0">
                <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
                  <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                    <ListPlus />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-extrabold">{r.name}</h3>
                      {r.paused && <Badge text="PAUSADA" />}
                      {r.taken && !r.paused && <Badge text="CONCLUÍDA" green />}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.medicineIds.map(id=>{const m=medicines.find(m=>m.id===id);const dose=r.doses[id];return m ? `${m.name}${dose?.quantity ? ` · ${dose.quantity} ${unitLabel(dose.unit)}` : " · quantidade pendente"}` : "";}).filter(Boolean).map((name) => (
                        <span
                          key={name}
                          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
                      <span className="flex items-center gap-1.5 font-bold text-slate-800">
                        <Clock3 className="size-4 text-blue-600" />
                        {r.time}
                      </span>
                      <span>Limite {r.limit}</span>
                      <span>{r.period}</span>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {r.taken && !r.paused && (
                      <Button
                        onClick={() => sendWhatsApp(r)}
                        disabled={isViewer}
                        className="h-11 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                      >
                        <MessageCircle />
                        Enviar pelo WhatsApp
                      </Button>
                    )}
                    {!r.paused && (
                      <Button
                        onClick={() => toggleTaken(r.id)}
                        disabled={isViewer || intakeBusy}
                        variant={r.taken ? "outline" : "default"}
                        className={
                          "h-11 w-full rounded-xl sm:w-auto " +
                          (!r.taken ? "bg-blue-600" : "")
                        }
                      >
                        {r.taken ? (
                          <>
                            <RotateCcw />
                            Desfazer
                          </>
                        ) : (
                          <>
                            <Check />
                            Concluir rotina
                          </>
                        )}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isViewer}
                          aria-label={
                            isViewer
                              ? "Ações indisponíveis no modo visualizador"
                              : "Ações da rotina"
                          }
                        >
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditRoutine(r)}>
                          <Pencil />
                          Alterar rotina
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => togglePause(r.id)}>
                          {r.paused ? <RotateCcw /> : <Pause />}
                          {r.paused ? "Retomar" : "Pausar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => remove(r.id)}
                          className="text-red-600"
                        >
                          <Trash2 />
                          Arquivar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {!r.paused && !r.taken && (
                  <div className="border-t bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 sm:px-6">
                    Lembrete às {r.time} e alerta final às {r.limit}
                  </div>
                )}
                {r.taken && !r.paused && (
                  <div className="border-t bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 sm:px-6">
                    Conclusão registrada. O envio pelo WhatsApp precisa ser
                    confirmado no aplicativo.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
        <output className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          <BellRing className="size-4" />
          {notice}
        </output>
        <p className="mt-7 text-center text-xs text-slate-400">
          Início da utilização do sistema no dia 21 de Setembro de 2026
        </p>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  placeholder,
  type = "text",
  value,
  optional = false,
  disabled = false,
}: {
  id: string;
  label: string;
  placeholder?: string;
  type?: string;
  value?: string;
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        className="min-w-0 w-full"
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        defaultValue={value}
        required={!optional && !disabled}
        disabled={disabled}
      />
    </div>
  );
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToMinutes(time: string) {
  const [hours = 0, minutes = 0] = time
    .split(":")
    .map((value) => Number(value));
  return hours * 60 + minutes;
}

function dateKeysBetween(startKey: string, endKey: string) {
  if (!startKey || !endKey) return [];
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  const dates: string[] = [];
  for (
    const current = new Date(start);
    current <= end;
    current.setDate(current.getDate() + 1)
  ) {
    dates.push(localDateKey(current));
  }
  return dates;
}

function formatDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("pt-BR");
}

function ReportCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "red";
}) {
  const colors = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className={`rounded-2xl p-3 text-center ${colors[tone]}`}>
      <strong className="block text-2xl">{value}</strong>
      <span className="text-xs font-semibold sm:text-sm">{label}</span>
    </div>
  );
}

function ReportStatus({
  status,
  takenAt,
  compact = false,
}: {
  status: "taken" | "pending" | "missed";
  takenAt?: string;
  compact?: boolean;
}) {
  if (status === "taken")
    return (
      <span className="w-fit rounded-full bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700">
        {compact
          ? "Tomado"
          : `Tomado às ${new Date(takenAt || "").toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}`}
      </span>
    );
  if (status === "pending")
    return (
      <span className="w-fit rounded-full bg-blue-100 px-3 py-2 text-sm font-bold text-blue-700">
        Pendente
      </span>
    );
  return (
    <span className="w-fit rounded-full bg-red-100 px-3 py-2 text-sm font-bold text-red-700">
      Não tomado
    </span>
  );
}
function Summary({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="rounded-3xl">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-5 grid size-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
          {icon}
        </div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-3xl font-extrabold">{value}</p>
        <p className="mt-1 truncate text-sm font-semibold">{note}</p>
      </CardContent>
    </Card>
  );
}
function Badge({ text, green = false }: { text: string; green?: boolean }) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-1 text-xs font-bold " +
        (green
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600")
      }
    >
      {text}
    </span>
  );
}
