import { CsvValidationError, inspectCsvFile } from "@/lib/csv/recipients";
import { createImportPreviewToken } from "@/lib/csv/import-token";
import { authorizeDraftImport, getImportForm } from "@/lib/csv/import-request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeDraftImport(request, id);
  if (authorization.response) return authorization.response;

  const form = await getImportForm(request);
  if (form.response) return form.response;
  try {
    const { preview } = await inspectCsvFile(form.file!);
    const token = createImportPreviewToken(authorization.userId!, id, preview.digest);
    return Response.json({ ...preview, token });
  } catch (error) {
    const message = error instanceof CsvValidationError ? error.message : "Could not validate the CSV file.";
    return Response.json({ message }, { status: 400 });
  }
}
