import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "@/lib/file-access";
import {
  IMAGE_PREVIEW_MAX_BYTES,
  getAudioMime,
  getDocumentMime,
  getImageMime,
  getVideoMime,
} from "@/lib/file-types";
import { isFilePathReferencedBySession } from "@/lib/session-file-references";
import { isApiRequestAllowed } from "@/lib/request-security";
import {
  inspectUploadTargets,
  parseUploadConflictStrategy,
  replaceUploadFile,
  validateUploadFileNames,
} from "@/lib/file-upload";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { filePathFromApiSegments } from "@/lib/paths";
import { hasParentDirectorySegment } from "@/lib/path-security";
import { contentDisposition } from "@/lib/content-disposition";

// One limit for a request's files together; a single file may use all of it.
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
// Multipart boundaries and headers are not file bytes, but must be bounded too.
const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;

async function getUploadDirectory(segments: string[]): Promise<
  { directory: string } | { response: NextResponse }
> {
  const directory = filePathFromApiSegments(segments);
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(directory, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch {
    return { response: NextResponse.json({ error: "Upload directory not found" }, { status: 404 }) };
  }
  if (!stat.isDirectory()) {
    return { response: NextResponse.json({ error: "Upload target is not a directory" }, { status: 400 }) };
  }

  // A browsable directory can be a symlink. Resolve both sides before writes
  // so a symlink inside an allowed root cannot redirect uploads outside it.
  const realDirectory = fs.realpathSync(directory);
  const realRoots = new Set<string>();
  for (const root of allowedRoots) {
    try {
      realRoots.add(fs.realpathSync(root));
    } catch {
      // Ignore stale session roots that no longer exist.
    }
  }
  if (!isFilePathAllowed(realDirectory, realRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }

  return { directory: realDirectory };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const { path: segments } = await params;
    const type = request.nextUrl.searchParams.get("type") ?? "upload";
    if (type !== "upload") {
      return NextResponse.json({ error: "Invalid upload request type" }, { status: 400 });
    }

    const uploadDirectory = await getUploadDirectory(segments);
    if ("response" in uploadDirectory) return uploadDirectory.response;
    const { directory } = uploadDirectory;

    const strategy = parseUploadConflictStrategy(request.nextUrl.searchParams.get("conflict"));
    if (!strategy) {
      return NextResponse.json({ error: "Invalid conflict strategy" }, { status: 400 });
    }

    let formData: FormData;
    try {
      formData = await parseFormDataWithinLimit(request, MAX_UPLOAD_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
      }
      throw error;
    }
    const files = formData.getAll("files").filter((entry): entry is File => typeof entry !== "string");
    if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
    }
    const fileNames = files.map((file) => file.name);
    const validationError = validateUploadFileNames(fileNames);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const inspection = inspectUploadTargets(directory, fileNames);
    if (strategy === "error" && inspection.conflicts.length > 0) {
      return NextResponse.json({
        error: "One or more files already exist",
        conflicts: inspection.conflicts,
        nonReplaceable: inspection.nonReplaceable,
      }, { status: 409 });
    }

    const conflictSet = new Set(inspection.conflicts);
    const nonReplaceableSet = new Set(inspection.nonReplaceable);
    const uploaded: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ name: string; error: string }> = [];

    for (const file of files) {
      const destination = path.join(/* turbopackIgnore: true */ directory, file.name);
      if (conflictSet.has(file.name) && strategy === "skip") {
        skipped.push(file.name);
        continue;
      }
      if (conflictSet.has(file.name) && nonReplaceableSet.has(file.name)) {
        errors.push({ name: file.name, error: "Cannot replace a directory or symbolic link" });
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(await file.arrayBuffer());
      } catch (error) {
        errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      try {
        // Async writes: a 100MB file written synchronously would stall every
        // stream and request this process serves until the disk catches up.
        if (conflictSet.has(file.name)) {
          await replaceUploadFile(destination, bytes);
        } else {
          await fs.promises.writeFile(destination, bytes, { flag: "wx" });
        }
        uploaded.push(file.name);
      } catch (error) {
        errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return NextResponse.json(
      { uploaded, skipped, errors },
      { status: errors.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
          // A client slower than the disk must not make the whole file pile up in memory.
          if ((controller.desiredSize ?? 1) <= 0) fileStream.pause();
        } catch {
          closed = true;
          fileStream.destroy();
        }
      });
      fileStream.once("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may cancel media probes before the file stream ends.
        }
      });
      fileStream.once("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // The response was already abandoned by the client.
        }
      });
    },
    pull() {
      if (!closed) fileStream.resume();
    },
    cancel() {
      closed = true;
      fileStream.destroy();
    },
  });
}

function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    // no-transform: Next gzips compressible route responses (SVG among them), a 206 included,
    // which turns a byte range into the range of a different body; file bytes go out as stored.
    "Cache-Control": "no-cache, no-transform",
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition("inline", path.basename(filePath), "download"),
    "X-Content-Type-Options": "nosniff",
  };
  // SVG is the only preview type a browser executes as a document. A
  // repo-controlled SVG navigated to directly (for example through a link in
  // a transcript) would otherwise run script in the Pi Web origin, where it
  // can call any /api route. These headers only affect document rendering;
  // <img> preview embedding ignores them.
  if (contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
    headers["Referrer-Policy"] = "no-referrer";
  }

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromApiSegments(segments);
    // Authorization collapses `..` lexically, but the filesystem applies it
    // after following links, so `link/../x` names a file beside the link's
    // target, outside the roots. URL parsing already drops real `..` segments;
    // only an encoded slash inside a segment still carries one here. The
    // existing-path check refuses them too, but a file referenced by the
    // session skips that check.
    if (hasParentDirectorySegment(filePath)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const type = request.nextUrl.searchParams.get("type") ?? "read";
    if (type !== "read") {
      return NextResponse.json({ error: "Invalid file request type" }, { status: 400 });
    }
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    const allowedRoots = await getAllowedFileRoots();
    const allowedByRoot = isFilePathAllowed(filePath, allowedRoots);
    const allowedBySessionReference =
      !allowedByRoot && await isFilePathReferencedBySession(filePath, sessionId);
    if (!allowedByRoot && !allowedBySessionReference) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!allowedBySessionReference && !isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }
    const imageMime = getImageMime(filePath);
    if (imageMime) {
      if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413 });
      }
      return streamFile(filePath, stat, imageMime, request.headers.get("range"));
    }
    const audioMime = getAudioMime(filePath);
    if (audioMime) {
      return streamFile(filePath, stat, audioMime, request.headers.get("range"));
    }
    const videoMime = getVideoMime(filePath);
    if (videoMime) {
      return streamFile(filePath, stat, videoMime, request.headers.get("range"));
    }
    const documentMime = getDocumentMime(filePath);
    if (documentMime) {
      return streamFile(filePath, stat, documentMime, request.headers.get("range"));
    }
    // Text is not shown in the app any more: the chat reads media, and
    // anything else has to be downloaded or read in an editor.
    return NextResponse.json({ error: "Not a media file" }, { status: 415 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
