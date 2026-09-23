import { revalidatePath } from "next/cache";
import { CsvValidationError, inspectCsvFile } from "@/lib/csv/recipients";
import { validateImportPreviewToken } from "@/lib/csv/import-token";
import { authorizeDraftImport, getImportForm } from "@/lib/csv/import-request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeDraftImport(request, id);
  if (authorization.response) return authorization.response;

  const form = await getImportForm(request);
  if (form.response) return form.response;
  try {
    const { preview, recipients } = await inspectCsvFile(form.file!);
    if (typeof form.token !== "string" || !validateImportPreviewToken(form.token, authorization.userId!, id, preview.digest)) {
      return Response.json({ message: "The preview expired or the file changed. Review the CSV again before importing." }, { status: 409 });
    }
    if (recipients.length === 0) {
      return Response.json({ message: "This CSV has no valid recipients to import." }, { status: 400 });
    }
    const { data, error } = await authorization.supabase!.rpc("replace_campaign_recipients", {
      p_campaign_id: id,
      p_recipients: recipients,
    });
    if (error) return Response.json({ message: "Could not save recipients. The previous list is unchanged." }, { status: 409 });
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    return Response.json({ imported: data });
  } catch (error) {
    const message = error instanceof CsvValidationError ? error.message : "Could not validate the CSV file.";
    return Response.json({ message }, { status: 400 });
  }
}
