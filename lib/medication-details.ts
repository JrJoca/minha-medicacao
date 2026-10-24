export type MedicationDetailsDraft = {name: string; dosage: string; link: string};

export function parseMedicationDetails(draft: MedicationDetailsDraft) {
  const name = draft.name.trim();
  const dosage = draft.dosage.trim();
  if (!name || Array.from(name).length > 120) throw new Error("Informe o nome do medicamento, com até 120 caracteres.");
  if (!dosage) throw new Error("Informe a dosagem do medicamento.");
  const link = draft.link.trim();
  if (link) {
    let url: URL;
    try { url = new URL(link); }
    catch { throw new Error("Informe um link válido começando com http ou https."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Use um link http ou https sem credenciais.");
    }
  }
  return {name, dosage, reference_url: link || null};
}
