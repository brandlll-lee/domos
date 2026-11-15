import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBotSession } from "@domos/agent/conversations";
import { messageText } from "@domos/agent/messages";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, onTestFinished, test } from "vitest";
import { EngineMessage } from "../../../packages/agent/src/harness/state.ts";
import { userMessage } from "../../../packages/agent/src/harness/task-types.ts";
import { botInput, context, setup } from "./fixtures/api.ts";

test("file search returns published history, pages unique files and excludes staged uploads", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  try {
    const botId = runtime.conversation.id;
    faux.setResponses([
      fauxAssistantMessage("Received"),
      fauxAssistantMessage("Received again"),
    ]);
    const file = await runtime.client.files.upload({
      botId,
      file: new File(["# report"], "报告.md"),
    });
    const second = await runtime.client.files.upload({
      botId,
      file: new File(["name,value\na,1"], "表格.csv"),
    });
    await runtime.client.files.upload({
      botId,
      file: new File(["draft"], "草稿.txt"),
    });
    await runtime.client.send({
      botId,
      text: "read",
      requestId: crypto.randomUUID(),
      attachments: [file.id, second.id],
    });
    await runtime.conversation.waitForIdle(context);
    await runtime.client.send({
      botId,
      text: "again",
      requestId: crypto.randomUUID(),
      attachments: [file.id],
    });
    await runtime.conversation.waitForIdle(context);
    const page = await runtime.client.files.list({
      botId,
      query: "报告",
      offset: 0,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      file: { id: file.id, name: "报告.md" },
      messageId: expect.any(String),
      cursor: expect.stringMatching(/^\d+:\d+$/),
    });
    expect(page.next).toBeNull();
    const firstPage = await runtime.client.files.list({ botId, limit: 1 });
    expect(firstPage.items[0]?.file.id).toBe(file.id);
    expect(firstPage.next).toBe(1);
    const secondPage = await runtime.client.files.list({
      botId,
      offset: 1,
      limit: 1,
    });
    expect(secondPage.items[0]?.file.id).toBe(second.id);
    expect(secondPage.next).toBeNull();
    expect(
      (await runtime.client.files.list({ botId, category: "media" })).items,
    ).toEqual([]);
    expect(
      (await runtime.client.files.list({ botId, category: "audio" })).items,
    ).toEqual([]);
    expect(
      (
        await runtime.client.files.list({
          botId,
          category: "files",
          offset: 1,
          limit: 1,
        })
      ).items[0]?.file.id,
    ).toBe(second.id);
    expect(
      (await runtime.client.files.list({ botId, query: "草稿" })).items,
    ).toEqual([]);
    const { png } = await import(
      "../../../packages/agent/test/fixtures/png.ts"
    );
    const image = await runtime.client.files.upload({
      botId,
      file: new File([png(320, 240)], "照片.png"),
    });
    const audio = await runtime.client.files.upload({
      botId,
      file: new File(
        [
          await readFile(
            new URL(
              "../../../packages/agent/test/fixtures/media/audio.mp3",
              import.meta.url,
            ),
          ),
        ],
        "语音.mp3",
      ),
    });
    const video = await runtime.client.files.upload({
      botId,
      file: new File(
        [
          await readFile(
            new URL(
              "../../../packages/agent/test/fixtures/media/video.mp4",
              import.meta.url,
            ),
          ),
        ],
        "录像.mp4",
      ),
    });
    faux.setResponses([fauxAssistantMessage("Media received")]);
    await runtime.client.send({
      botId,
      text: "media",
      requestId: crypto.randomUUID(),
      attachments: [image.id, audio.id, video.id],
    });
    await runtime.conversation.waitForIdle(context);
    const media = await runtime.client.files.list({
      botId,
      category: "media",
      limit: 1,
    });
    expect(media.items.map((item) => item.file.id)).toEqual([image.id]);
    expect(media.next).toBe(1);
    expect(
      (
        await runtime.client.files.list({
          botId,
          category: "media",
          offset: 1,
          limit: 1,
        })
      ).items.map((item) => item.file.id),
    ).toEqual([video.id]);
    expect(
      (await runtime.client.files.list({ botId, category: "audio" })).items.map(
        (item) => item.file.id,
      ),
    ).toEqual([audio.id]);
    expect(
      (
        await runtime.client.files.list({
          botId,
          category: "files",
          query: "照片",
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await runtime.client.files.list({
          botId,
          category: "files",
          limit: 1,
          offset: 1,
        })
      ).items[0]?.file.id,
    ).toBe(second.id);
    const thumbnail = await runtime.app.request(
      `/files/${botId}/${image.id}/preview`,
    );
    expect(thumbnail.status).toBe(200);
    expect(await thumbnail.json()).toMatchObject({
      kind: "image",
      thumbnail: expect.stringMatching(/^data:image\//),
    });
    const other = await runtime.client.bots.create(botInput("Other"));
    expect(
      (await runtime.client.files.list({ botId: other.id })).items,
    ).toEqual([]);
    expect(
      (await runtime.app.request(`/files/${other.id}/${image.id}/preview`))
        .status,
    ).toBe(404);
    await expect(
      runtime.client.files.list({ botId: 99999999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await runtime.harness.close(context);
  }
});

test("interactive HTML delivery keeps its file snapshot and display metadata after restart", async () => {
  const { open, faux } = await setup();
  const first = await open();
  const botId = first.conversation.id;
  const source = "<!doctype html><button>计算</button>";
  let fileId = "";
  try {
    const upload = await first.client.files.upload({
      botId,
      file: new File([source], "计算器.html"),
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("attach_file", { path: upload.path, display: "inline" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Ready"),
    ]);
    await first.client.send({
      botId,
      text: "calculator",
      requestId: crypto.randomUUID(),
    });
    await first.conversation.waitForIdle(context);
    const items = (await first.client.files.list({ botId })).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.file).toMatchObject({
      display: "inline",
      mimeType: "text/html",
    });
    fileId = items[0]?.file.id ?? "";
    expect((await first.app.request(`/files/${botId}/${fileId}`)).status).toBe(
      404,
    );
    const text = await first.client.files.upload({
      botId,
      file: new File(["text"], "note.txt"),
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("attach_file", { path: text.path, display: "inline" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Not a page"),
    ]);
    await first.client.send({
      botId,
      text: "bad inline",
      requestId: crypto.randomUUID(),
    });
    await first.conversation.waitForIdle(context);
    expect((await first.client.files.list({ botId })).items).toHaveLength(1);
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    expect(
      (await second.client.files.list({ botId })).items[0]?.file.display,
    ).toBe("inline");
    expect(
      await (await second.client.files.download({ botId, id: fileId })).text(),
    ).toBe(source);
    const other = await second.client.bots.create(botInput("Other"));
    await expect(
      second.client.files.download({ botId: other.id, id: fileId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await second.harness.close(context);
  }
});

test("link preview reads keep Bot scope and reject invalid destinations", async () => {
  const { open } = await setup();
  const runtime = await open();
  try {
    const botId = runtime.conversation.id;
    expect(
      await runtime.client.files.linkPreview({
        botId,
        url: "https://127.0.0.1/private",
      }),
    ).toEqual({ status: "blocked", error: "预览地址被安全规则拦截。" });
    await expect(
      runtime.client.files.linkPreview({ botId, url: "javascript:alert(1)" }),
    ).rejects.toThrow();
    await expect(
      runtime.client.files.linkPreview({
        botId,
        url: "https://user:pass@example.com",
      }),
    ).rejects.toThrow();
    await expect(
      runtime.client.files.linkPreview({
        botId: 999999,
        url: "https://example.com",
      }),
    ).rejects.toThrow();
  } finally {
    await runtime.harness.close(context);
  }
});

test("image previews use file content, retain Bot ownership, and restore stored images", async () => {
  const { open } = await setup();
  const first = await open();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  let image: Awaited<ReturnType<typeof first.files.upload>>;
  const botId = first.conversation.id;
  try {
    image = await first.client.files.upload({
      botId,
      file: new File([bytes], "source.dat", { type: "text/plain" }),
    });
    expect(image.mimeType).toBe("image/png");
    const preview = await first.app.request(`/files/${botId}/${image.id}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/png");
    expect(preview.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    const other = await first.client.bots.create(botInput("Other"));
    expect(
      (await first.app.request(`/files/${other.id}/${image.id}`)).status,
    ).toBe(404);
    const text = await first.client.files.upload({
      botId,
      file: new File(["<svg></svg>"], "image.png", { type: "image/png" }),
    });
    expect(text.mimeType).toBe("application/octet-stream");
    expect((await first.app.request(`/files/${botId}/${text.id}`)).status).toBe(
      404,
    );
    const { mimeType: _mimeType, ...metadata } = image;
    await writeFile(
      join(
        first.files.root,
        String(botId),
        "artifacts",
        image.id,
        "metadata.json",
      ),
      JSON.stringify(metadata),
    );
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    const preview = await second.app.request(`/files/${botId}/${image.id}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    expect(
      (await second.client.files.download({ botId, id: image.id })).type,
    ).toBe("image/png");
  } finally {
    await second.harness.close(context);
  }
});

test("uploaded text becomes a real edited deliverable with durable downloads and Bot ownership", async () => {
  const { open, faux } = await setup();
  const first = await open();
  let fileId = "";
  let botId = first.conversation.id;
  let delivered = "";
  const text = `Source ${crypto.randomUUID()}`;
  try {
    const uploadRequestId = crypto.randomUUID();
    const upload = await first.client.files.upload({
      requestId: uploadRequestId,
      botId,
      file: new File([text], "资料.txt"),
    });
    expect(
      await first.client.files.upload({
        requestId: uploadRequestId,
        botId,
        file: new File([text], "资料.txt"),
      }),
    ).toEqual(upload);
    expect(
      (await first.client.files.download({ botId, id: upload.id })).name,
    ).toBe("资料.txt");
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: upload.path })], {
        stopReason: "toolUse",
      }),
      async (input) => {
        const read = input.messages.findLast(
          (message) => message.role === "toolResult",
        );
        expect(read?.role).toBe("toolResult");
        expect(
          messageText(read as Parameters<typeof messageText>[0]),
        ).toContain(text);
        return fauxAssistantMessage(
          [
            fauxToolCall("write", {
              path: "reports/report.md",
              content: `# Draft\n${text}`,
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        [
          fauxToolCall("edit", {
            path: "reports/report.md",
            edits: [{ oldText: "# Draft", newText: "# Report" }],
          }),
          fauxToolCall("attach_file", { path: "reports/report.md" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Report ready"),
    ]);
    const send = {
      botId,
      text: "Build a report",
      attachments: [upload.id],
      requestId: crypto.randomUUID(),
    };
    expect(await first.client.send(send)).toEqual(
      await first.client.send(send),
    );
    await first.conversation.waitForIdle(context);
    const view = await first.client.get({ botId });
    expect(view.messages.filter((item) => item.role === "user")).toHaveLength(
      1,
    );
    expect(view.messages[0]).toMatchObject({
      attachments: [upload],
      content: [{ type: "text", text: "Build a report" }],
    });
    const results = view.messages.filter((item) => item.role === "toolResult");
    expect(results.map((item) => [item.toolName, item.isError])).toEqual([
      ["read", false],
      ["write", false],
      ["edit", false],
      ["attach_file", false],
    ]);
    const attachment = results.at(-1)?.attachments?.[0];
    expect(attachment?.name).toBe("report.md");
    fileId = attachment?.id ?? "";
    delivered = await (
      await first.client.files.download({ botId, id: fileId })
    ).text();
    expect(delivered).toBe(`# Report\n${text}`);
    const workspace = await first.files.workspace(botId);
    await workspace.writeFile("reports/report.md", "changed", context);
    expect(
      await (await first.client.files.download({ botId, id: fileId })).text(),
    ).toBe(delivered);
    const other = await first.client.bots.create(botInput("Other"));
    await expect(
      first.client.files.download({ botId: other.id, id: fileId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      first.client.send({
        botId: other.id,
        text: "Read it",
        attachments: [upload.id],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await first.harness.close(context);
  }
  const second = await open();
  try {
    botId = second.conversation.id;
    expect(
      await (await second.client.files.download({ botId, id: fileId })).text(),
    ).toBe(delivered);
    expect(
      (await second.client.get({ botId })).messages.some((item) =>
        item.attachments?.some((file) => file.id === fileId),
      ),
    ).toBe(true);
  } finally {
    await second.harness.close(context);
  }
});

test("file routes reject invalid targets, oversized uploads, and empty submissions", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    await expect(
      runtime.client.files.upload({
        botId: 999999,
        file: new File(["a"], "a.txt"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runtime.client.files.upload({
        botId,
        file: new File([new Uint8Array(100 * 1024 * 1024 + 1)], "large.txt"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runtime.client.send({ botId, text: "", requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const file = await runtime.client.files.upload({
      botId,
      file: new File(["attached"], "a.txt"),
    });
    faux.setResponses([fauxAssistantMessage("Received file")]);
    await runtime.client.send({
      botId,
      text: "",
      attachments: [file.id],
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    expect(
      (await runtime.client.get({ botId })).messages[0]?.attachments,
    ).toEqual([file]);
  } finally {
    await runtime.harness.close(context);
  }
});

test("draft cleanup preserves sent snapshots and separates independent uploads", async () => {
  const { open, faux } = await setup();
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    const input = {
      botId,
      file: new File(["draft"], "draft.txt"),
      requestId: crypto.randomUUID(),
    };
    const first = await runtime.client.files.upload(input);
    expect(await runtime.client.files.upload(input)).toEqual(first);
    const second = await runtime.client.files.upload({
      ...input,
      requestId: crypto.randomUUID(),
    });
    expect(second.id).not.toBe(first.id);
    await runtime.client.files.discard({ botId, id: first.id });
    const teamFile = await runtime.client.files.upload({
      ...input,
      requestId: crypto.randomUUID(),
    });
    const session = await createBotSession(
      runtime.harness,
      botId,
      { purpose: "team", teamId: "team" },
      context,
    );
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(session, {
        kind: EngineMessage,
        data: userMessage("team-file", "Shared", [teamFile], "team-file"),
      });
    }, context);
    await runtime.client.files.discard({ botId, id: teamFile.id });
    expect(
      await (
        await runtime.client.files.download({ botId, id: teamFile.id })
      ).text(),
    ).toBe("draft");
    await expect(
      runtime.client.files.download({ botId, id: first.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await runtime.client.files.download({ botId, id: second.id }),
    ).toBeInstanceOf(File);
    faux.setResponses([fauxAssistantMessage("Received")]);
    await runtime.client.send({
      botId,
      text: "Read this",
      attachments: [second.id],
      requestId: crypto.randomUUID(),
    });
    await runtime.conversation.waitForIdle(context);
    await runtime.client.files.discard({ botId, id: second.id });
    expect(
      await (
        await runtime.client.files.download({ botId, id: second.id })
      ).text(),
    ).toBe("draft");
    await runtime.client.files.discard({ botId, id: first.id });
  } finally {
    await runtime.harness.close(context);
  }
});

test("attachment validation uses detected MIME and the selected model capability", async () => {
  const { open, models } = await setup();
  models.setProvider(
    fauxProvider({ models: [{ id: "text-only", input: ["text"] }] }).provider,
  );
  const runtime = await open();
  const botId = runtime.conversation.id;
  try {
    await expect(
      runtime.client.files.upload({
        botId,
        file: new File(
          [new Uint8Array([0x42, 0x4d, ...new Uint8Array(62)])],
          "photo.bmp",
        ),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("photo.bmp"),
    });
    const { png } = await import(
      "../../../packages/agent/test/fixtures/png.ts"
    );
    const image = await runtime.client.files.upload({
      botId,
      file: new File([png(1, 1)], "source.bin"),
    });
    expect(image.mimeType).toBe("image/png");
    await runtime.client.models.select({
      botId,
      provider: "faux",
      modelId: "text-only",
    });
    await expect(
      runtime.client.send({
        botId,
        text: "Read this",
        attachments: [image.id],
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("source.bin"),
    });
    expect((await runtime.client.get({ botId })).messages).toEqual([]);
  } finally {
    await runtime.harness.close(context);
  }
});

test("local HTML entry points use fresh resources after an update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-local-entry-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const { open } = await setup(directory);
  const runtime = await open();
  onTestFinished(() => runtime.harness.close(context));
  for (const version of ["first", "second"]) {
    await writeFile(
      join(directory, "index.html"),
      `<script src="/assets/${version}.js"></script>`,
    );
    for (const path of ["/", "/index.html"]) {
      const response = await runtime.app.request(`http://localhost${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain(`/assets/${version}.js`);
    }
  }
});

test("raw uploads and range downloads preserve bytes and Bot ownership", async () => {
  const { open } = await setup();
  const runtime = await open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const bytes = Buffer.from("0123456789");
  const uploaded = await runtime.app.request(
    `/files/${botId}/upload?name=test.bin&requestId=${crypto.randomUUID()}`,
    { method: "PUT", body: bytes },
  );
  expect(uploaded.status).toBe(200);
  const file = (await uploaded.json()) as { id: string };
  const url = `/files/${botId}/${file.id}?download=1`;
  for (const [range, body, contentRange] of [
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
  ] as const) {
    const response = await runtime.app.request(url, {
      headers: { Range: range },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(await response.text()).toBe(body);
  }
  expect(
    (await runtime.app.request(url, { headers: { Range: "bytes=99-" } }))
      .status,
  ).toBe(416);
  expect(
    (await runtime.app.request(url, { headers: { Range: "bytes=0-1,3-4" } }))
      .status,
  ).toBe(416);
  expect(
    (await runtime.app.request(`/files/${botId + 1}/${file.id}?download=1`))
      .status,
  ).toBe(404);
  expect(
    (
      await runtime.app.request(
        `/files/${botId}/upload?name=test.bin&requestId=${crypto.randomUUID()}`,
        {
          method: "PUT",
          headers: { "Content-Length": String(100 * 1024 * 1024 + 1) },
          body: "x",
        },
      )
    ).status,
  ).toBe(413);
});

test("spreadsheet previews retain the file owner boundary", async () => {
  const { open } = await setup();
  const runtime = await open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const file = await runtime.client.files.upload({
    botId,
    file: new File(
      [
        await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/office/data.xlsx",
            import.meta.url,
          ),
        ),
      ],
      "data.xlsx",
    ),
  });
  const preview = await runtime.app.request(
    `/files/${botId}/${file.id}/preview?sheet=${encodeURIComponent("明细")}`,
  );
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    kind: "xlsx",
    sheet: "明细",
    rows: [["第二张表"]],
  });
  const other = await runtime.client.bots.create(botInput("Other"));
  expect(
    (await runtime.app.request(`/files/${other.id}/${file.id}/preview`)).status,
  ).toBe(404);
  expect(
    (
      await runtime.app.request(
        `/files/${botId}/${file.id}/preview?sheet=missing`,
      )
    ).status,
  ).toBe(422);
});

test("document attachments retain authorized downloads and report the preview fallback", async () => {
  const { open } = await setup();
  const runtime = await open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const other = await runtime.client.bots.create(botInput("Other"));
  for (const name of ["report.docx", "slides.pptx"]) {
    const bytes = await readFile(
      new URL(
        `../../../packages/agent/test/fixtures/office/${name}`,
        import.meta.url,
      ),
    );
    const file = await runtime.client.files.upload({
      botId,
      file: new File([bytes], name),
    });
    const preview = await runtime.app.request(
      `/files/${botId}/${file.id}/preview`,
    );
    expect(preview.status).toBe(422);
    expect(await preview.text()).toBe(
      "此格式暂不支持预览，请下载后使用本机应用打开。",
    );
    const download = await runtime.app.request(
      `/files/${botId}/${file.id}?download=1`,
    );
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(
      (await runtime.app.request(`/files/${other.id}/${file.id}?download=1`))
        .status,
    ).toBe(404);
    expect(
      (await runtime.app.request(`/files/${other.id}/${file.id}/preview`))
        .status,
    ).toBe(404);
  }
});
