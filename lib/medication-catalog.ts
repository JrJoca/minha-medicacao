export type MedicationRecord = {
  id: string;
  name: string;
  dosage: string;
  reference_url: string | null;
};
export type CatalogRead = { data: unknown; error: unknown };
export type MedicationLinkRead = {
  data: { routine_id: string; medication_id: string }[] | null;
  error: unknown;
};

type CatalogQueries = {
  all: () => PromiseLike<CatalogRead>;
  links: () => PromiseLike<CatalogRead>;
  byIds: (ids: string[]) => PromiseLike<CatalogRead>;
};

function records(result: CatalogRead): MedicationRecord[] {
  if (result.error || !Array.isArray(result.data)) throw new Error("catalog-read");
  if (!result.data.every(row => row && typeof row.id === "string" &&
    typeof row.name === "string" && typeof row.dosage === "string" &&
    (row.reference_url === null || typeof row.reference_url === "string"))) {
    throw new Error("catalog-shape");
  }
  return result.data;
}

// Uma resposta vazia só representa ausência quando não há vínculos conhecidos.
// A recuperação continua usando o mesmo cliente autenticado e as mesmas RLS.
export async function readMedicationCatalog(queries: CatalogQueries) {
  const rows = records(await queries.all());
  if (rows.length) return { rows, recoveredFromLinks: false };
  const linked = await queries.links();
  if (linked.error || !Array.isArray(linked.data) ||
    !linked.data.every(id => typeof id === "string" && id.length)) {
    throw new Error("catalog-links");
  }
  const ids = [...new Set(linked.data as string[])];
  if (!ids.length) return { rows: [], recoveredFromLinks: false };
  const recovered = records(await queries.byIds(ids));
  const visible = new Set(recovered.map(row => row.id));
  if (!ids.every(id => visible.has(id))) throw new Error("catalog-incomplete");
  return { rows: recovered, recoveredFromLinks: true };
}
