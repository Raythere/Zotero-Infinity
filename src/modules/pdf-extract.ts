declare const Zotero: any;

export interface PaperContext {
  title: string;
  authors: string;
  year: string;
  itemType: string;
  abstract: string;
  text: string;
}

/** Get the currently selected Zotero items (regular items only, no attachments/notes). */
export function getSelectedItems(win: Window): any[] {
  const pane =
    (win as any).ZoteroPane ||
    (win as any).Zotero?.getActiveZoteroPane?.() ||
    Zotero.getActiveZoteroPane?.();
  const all: any[] = pane?.getSelectedItems?.() || [];
  return all.filter((it: any) => it.isRegularItem?.());
}

/** Format creator names into a comma-separated string. */
export function formatCreators(item: any): string {
  try {
    const creators = item.getCreators?.() || [];
    if (!creators.length) return "";
    return creators
      .map((c: any) => {
        const first = c.firstName || "";
        const last = c.lastName || "";
        const name = `${first} ${last}`.trim();
        return name || c.name || "";
      })
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

/** Extract text from a single PDF attachment item. */
export async function getAttachmentText(att: any): Promise<string> {
  const path = await att.getFilePathAsync?.();
  if (!path) return "[PDF file not found on disk]";
  const text = await att.attachmentText;
  return text || "";
}

/** Collect PDF attachments -- handles both parent items and standalone attachments. */
export function getPdfAttachments(item: any): any[] {
  if (
    item.isAttachment?.() &&
    item.attachmentContentType === "application/pdf"
  ) {
    return [item];
  }
  const attIDs = item.getAttachments?.() || [];
  const pdfs: any[] = [];
  for (const id of attIDs) {
    const att = Zotero.Items.get(id);
    if (att && att.attachmentContentType === "application/pdf") {
      pdfs.push(att);
    }
  }
  return pdfs;
}

/** Extract metadata from a Zotero item (no PDF text). */
export function getItemMetadata(item: any): Omit<PaperContext, "text"> {
  const title = item.getField?.("title") || "";
  const date = item.getField?.("date") || "";
  const year = (date.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const itemType = item.itemTypeID
    ? Zotero.ItemTypes.getName(item.itemTypeID)
    : "";
  const authors = formatCreators(item);
  const abstract = item.getField?.("abstractNote") || "";
  return { title, authors, year, itemType, abstract };
}

/** Extract full paper context (metadata + PDF text) from one Zotero item. */
export async function extractPaperContext(item: any): Promise<PaperContext> {
  const meta = getItemMetadata(item);
  const pdfs = getPdfAttachments(item);

  let text = "";
  for (const att of pdfs) {
    try {
      const t = await getAttachmentText(att);
      if (t) text += (text ? "\n\n" : "") + t;
    } catch (e) {
      Zotero.debug(`[zotero-local-ai] PDF text error: ${String(e)}`);
    }
  }

  return { ...meta, text };
}

/** Extract paper contexts from multiple items. */
export async function extractPaperContexts(
  items: any[],
): Promise<PaperContext[]> {
  const results: PaperContext[] = [];
  for (const item of items) {
    try {
      results.push(await extractPaperContext(item));
    } catch (e) {
      Zotero.debug(`[zotero-local-ai] extractPaperContext error: ${String(e)}`);
    }
  }
  return results;
}
