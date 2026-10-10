import { describe, expect, it } from "vitest";
import { imageMarkdown, insertBlock, replacePlaceholder, uploadPlaceholder } from "./markdown-edit";

describe("insertBlock", () => {
  it("surrounds the block with blank lines so it becomes its own paragraph", () => {
    expect(insertBlock("前文后文", 2, 2, "![](a.png)")).toEqual({ value: "前文\n\n![](a.png)\n\n后文", cursor: 14 });
  });

  it("does not add blank lines that already exist", () => {
    expect(insertBlock("前文\n\n", 4, 4, "X").value).toBe("前文\n\nX\n\n");
    expect(insertBlock("前文\n后文", 3, 3, "X").value).toBe("前文\n\nX\n\n后文");
  });

  it("adds nothing before the block at the very start", () => {
    expect(insertBlock("", 0, 0, "X")).toEqual({ value: "X\n\n", cursor: 1 });
  });

  it("replaces the selected text", () => {
    expect(insertBlock("abc选中def", 3, 5, "X").value).toBe("abc\n\nX\n\ndef");
  });
});

describe("imageMarkdown", () => {
  it("escapes characters that would end the link early", () => {
    expect(imageMarkdown("https://img.test/a (1).png")).toBe("![](https://img.test/a%20%281%29.png)");
  });

  it("strips brackets from alt text", () => {
    expect(imageMarkdown("https://img.test/a.png", "图[1]")).toBe("![图1](https://img.test/a.png)");
  });
});

describe("replacePlaceholder", () => {
  const placeholder = uploadPlaceholder("1", "照片[1].jpg");

  it("builds a placeholder without brackets from the file name", () => {
    expect(placeholder).toBe("![上传中：照片1.jpg…](upload:1)");
  });

  it("swaps in the final markdown wherever the placeholder moved to", () => {
    const value = `新打的字\n\n${placeholder}\n\n后文`;
    expect(replacePlaceholder(value, placeholder, "![](u)")).toBe("新打的字\n\n![](u)\n\n后文");
  });

  it("removes the placeholder and its padding on failure, leaving other blank lines alone", () => {
    const value = `前文\n\n${placeholder}\n\n后文\n\n\n\n代码里的空行`;
    expect(replacePlaceholder(value, placeholder, "")).toBe("前文\n\n后文\n\n\n\n代码里的空行");
  });

  it("leaves the text alone if the author deleted the placeholder", () => {
    expect(replacePlaceholder("全部删掉了", placeholder, "![](u)")).toBe("全部删掉了");
  });
});
