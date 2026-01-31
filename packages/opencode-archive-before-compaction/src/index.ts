/**
 * Archive-before-compaction OpenCode plugin (global or project-local)
 *
 * - Hooks: experimental.session.compacting
 * - Action: saves full pre-compaction transcript to:
 *     <worktree>/.opencode/archive/sessions/<sessionId>/<timestamp>.md
 *     <worktree>/.opencode/archive/sessions/<sessionId>/<timestamp>.json
 *   plus a de-dupe marker: .last.sha256
 * - Enhancement: injects an “archive location + grepai guidance” block into the compaction context
 */

import type { Plugin } from "@opencode-ai/plugin"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

type SessionMessage = {
  info: {
    id: string
    role?: string
    createdAt?: string
  }
  parts: Array<
    | { type: "text"; text: string }
    | { type: string; [k: string]: any }
  >
}

function safeSlug(s: string) {
  return (s || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown"
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function isoCompact(d = new Date()) {
  // 2026-01-30T15-04-05Z (filesystem friendly)
  return d.toISOString().replace(/:/g, "-")
}

function renderPartsToMarkdown(parts: SessionMessage["parts"]) {
  let out = ""
  for (const p of parts || []) {
    if (p?.type === "text") {
      out += p.text ?? ""
      if (!out.endsWith("\n")) out += "\n"
      continue
    }

    // Preserve non-text parts (tools, attachments, etc.) as JSON blocks
    const clone = { ...p }
    out += "\n```json\n" + JSON.stringify(clone, null, 2) + "\n```\n"
  }
  return out.trimEnd() + "\n"
}

function tryGetSessionIdFromInput(input: any): string | undefined {
  // Be defensive: hook payload shapes can change by version.
  return (
    input?.session?.id ??
    input?.sessionID ??
    input?.sessionId ??
    input?.id ??
    input?.session_id
  )
}

const ArchiveBeforeCompact: Plugin = async ({ client, worktree }) => {
  const archiveRoot = path.join(worktree, ".opencode", "archive")
  const sessionsRoot = path.join(archiveRoot, "sessions")

  async function getMessages(sessionId: string): Promise<SessionMessage[]> {
    // SDK: client.session.messages({ path: { id: sessionId } })
    const res = await client.session.messages({ path: { id: sessionId } })
    const data = (res as any).data ?? res
    return (data ?? []) as SessionMessage[]
  }

  async function writeArchive(sessionId: string, messages: SessionMessage[]) {
    await mkdir(sessionsRoot, { recursive: true })

    const sessionDir = path.join(sessionsRoot, safeSlug(sessionId))
    await mkdir(sessionDir, { recursive: true })

    // Render canonical content for hashing/dedupe
    const canonical = JSON.stringify(messages)
    const digest = sha256(canonical)

    const lastHashPath = path.join(sessionDir, ".last.sha256")
    const lastHash = existsSync(lastHashPath)
      ? (await readFile(lastHashPath, "utf8").catch(() => "")).trim()
      : ""

    if (lastHash === digest) return { wrote: false as const, digest, sessionDir }

    const stamp = isoCompact(new Date())
    const mdPath = path.join(sessionDir, `${stamp}.md`)
    const jsonPath = path.join(sessionDir, `${stamp}.json`)

    // Markdown view (human-friendly)
    let md = ""
    md += `# OpenCode Session Archive\n\n`
    md += `- sessionId: \`${sessionId}\`\n`
    md += `- archivedAt: \`${new Date().toISOString()}\`\n`
    md += `- sha256: \`${digest}\`\n\n`
    md += `---\n\n`

    for (const m of messages) {
      const role = m?.info?.role ?? "unknown"
      const createdAt = m?.info?.createdAt ?? ""
      md += `## ${role}${createdAt ? ` — ${createdAt}` : ""}\n\n`
      md += renderPartsToMarkdown(m.parts)
      md += `\n---\n\n`
    }

    await writeFile(mdPath, md, "utf8")
    await writeFile(jsonPath, JSON.stringify(messages, null, 2), "utf8")
    await writeFile(lastHashPath, digest + "\n", "utf8")

    return { wrote: true as const, digest, mdPath, jsonPath, sessionDir }
  }

  return {
    // Fires before the continuation summary is generated
    "experimental.session.compacting": async (input, output) => {
      const sessionId = tryGetSessionIdFromInput(input)
      if (!sessionId) {
        // Don’t break compaction if payload shape changes.
        await client.app.log({
          body: {
            service: "archive-before-compact",
            level: "warn",
            message:
              "Could not determine sessionId from experimental.session.compacting payload; skipping archive.",
            extra: { keys: Object.keys(input ?? {}) },
          },
        })
        return
      }

      try {
        const messages = await getMessages(sessionId)
        const result = await writeArchive(sessionId, messages)

        // Inject archive location into compaction context so the agent can refer back later.
        const relDir = path.relative(worktree, result.sessionDir) || result.sessionDir
        output.context ??= []
        output.context.push(`
## Conversation Archive (pre-compaction)

A full transcript was archived **before compaction**.

- Archive folder: \`${relDir}/\`
- Files: timestamped \`.md\` (human-readable) and \`.json\` (exact)

If you need older details that aren’t in the compacted summary, use the \`grepai\` tool to search this folder for key terms (names, IDs, filenames, error strings, vnums, etc.). Files are timestamped, so you can narrow by date if needed.
`.trim())

        if (result.wrote) {
          await client.app.log({
            body: {
              service: "archive-before-compact",
              level: "info",
              message: "Archived session before compaction",
              extra: {
                sessionId,
                sha256: result.digest,
                mdPath: result.mdPath,
                jsonPath: result.jsonPath,
              },
            },
          })
        } else {
          await client.app.log({
            body: {
              service: "archive-before-compact",
              level: "info",
              message: "Archive unchanged (dedupe hit); injected archive location into compaction context",
              extra: { sessionId, sha256: result.digest },
            },
          })
        }
      } catch (err: any) {
        // Never block compaction on archive failures.
        await client.app.log({
          body: {
            service: "archive-before-compact",
            level: "error",
            message: "Failed to archive session before compaction; continuing.",
            extra: { sessionId, error: String(err?.message ?? err) },
          },
        })
      }
    },
  }
}

export default ArchiveBeforeCompact
export { ArchiveBeforeCompact }
