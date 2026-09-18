export type PrescriptionMedicineDraft = {
  id: string;
  name: string;
  dosage: string;
  link: string;
};

const DOSAGE_PATTERN =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|mL|ui|u\.i\.|%|comprimidos?|cápsulas?|capsulas?|gotas?|sachês?|saches?)\b/i;
const INSTRUCTION_PATTERN =
  /\b(?:tomar|usar|aplicar|ingerir|administrar|via\s+oral|ao\s+dia|a\s+cada|por\s+\d+\s+(?:dias?|semanas?))\b/i;
const IGNORE_PATTERN =
  /^(?:receita|prescrição|prescricao|paciente|médico|medico|crm|data|assinatura|endereço|endereco|telefone|cpf)\b/i;

function cleanLine(value: string) {
  return value
    .replace(/[|_[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:\d+[.)-]|[-•])\s*/, "")
    .trim();
}

function makeDraft(name: string, dosage: string): PrescriptionMedicineDraft {
  return {
    id: crypto.randomUUID(),
    name: name.replace(/\s*[-–:]\s*$/, "").trim(),
    dosage: dosage.replace(/^\s*[-–:]\s*/, "").trim(),
    link: "",
  };
}

export function parsePrescriptionText(
  rawText: string,
): PrescriptionMedicineDraft[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length > 2 && !IGNORE_PATTERN.test(line));
  const drafts: PrescriptionMedicineDraft[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const dosageMatch = line.match(DOSAGE_PATTERN);
    if (!dosageMatch) continue;

    const doseIndex = dosageMatch.index ?? 0;
    let name = line.slice(0, doseIndex).replace(/[\s,:;-]+$/, "").trim();
    let dosage = line.slice(doseIndex).trim();

    if (!name || INSTRUCTION_PATTERN.test(name)) {
      const previous = lines[index - 1] || "";
      if (
        previous &&
        !DOSAGE_PATTERN.test(previous) &&
        !INSTRUCTION_PATTERN.test(previous)
      ) {
        name = previous;
      }
    }

    const next = lines[index + 1] || "";
    if (next && INSTRUCTION_PATTERN.test(next)) {
      dosage = `${dosage} • ${next}`;
      index += 1;
    }

    if (name.length < 2 || name.length > 100) continue;
    const normalizedName = name.toLocaleLowerCase("pt-BR");
    if (
      drafts.some(
        (item) => item.name.toLocaleLowerCase("pt-BR") === normalizedName,
      )
    )
      continue;
    drafts.push(makeDraft(name, dosage));
  }

  return drafts;
}

export async function readPrescriptionImage(
  file: File,
  onProgress: (progress: number) => void,
) {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "por", {
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress(Math.round((message.progress || 0) * 100));
      }
    },
  });
  return result.data.text;
}

export function emptyPrescriptionDraft(): PrescriptionMedicineDraft {
  return makeDraft("", "");
}
