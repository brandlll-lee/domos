import { expect, test } from "vitest";
import { previewText } from "../src/preview-text.ts";

test.each([
  ["我叫 **Domos** —— 你好。", "我叫 Domos —— 你好。"],
  [
    "**先看[资料](https://example.com)**，再看 `snake_case`。",
    "先看资料，再看 snake_case。",
  ],
  ["# 标题\n\n- 第一项\n- ~~第二项~~\n\n> 结束", "标题 第一项 第二项 结束"],
  ["| 名称 | 数量 |\n| --- | --- |\n| 文件 | 2 |", "名称 数量 文件 2"],
  ["```sh\necho hello\necho world\n```", "echo hello echo world"],
  [
    "![报告](report.png)\n\n[来源][ref]\n\n[ref]: https://example.com",
    "报告 来源",
  ],
  ["a_b_c * 2 = 4，\\*原样\\*", "a_b_c * 2 = 4，*原样*"],
  ["第一行\\\n第二行<br>末尾", "第一行 第二行末尾"],
])("previews display Markdown content: %s", (value, expected) => {
  expect(previewText(value)).toBe(expected);
});
