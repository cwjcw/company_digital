import { useContext, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Select, Space, Typography } from "antd";
import { Node } from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import type {
  KnowledgeAttachment,
  KnowledgeContentNode,
} from "@kdos/contracts";
import { api } from "../../api";
import {
  emptyKnowledgeContent,
  KnowledgeFileContext,
  knowledgeFileUrl,
} from "./knowledge-ui";
import "./knowledge.css";

function PrivateKnowledgeImage({ id, alt }: { id: string; alt: string }) {
  const context = useContext(KnowledgeFileContext);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const path = knowledgeFileUrl(id, context);
  useEffect(() => {
    setUrl("");
    setError("");
    let active = true;
    let objectUrl = "";
    const abort = new AbortController();
    void api<Blob>(path, { signal: abort.signal })
      .then((blob) => {
        if (!active) return;
        if (!(blob instanceof Blob)) throw new Error("图片不可用");
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setError("");
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url ? (
    <img src={url} alt={alt} className="knowledge-private-image" />
  ) : (
    <Typography.Text type="secondary">{error || "图片加载中…"}</Typography.Text>
  );
}
function ImageNode({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="knowledge-image-node">
      <PrivateKnowledgeImage
        id={String(node.attrs.attachmentId)}
        alt={String(node.attrs.alt ?? "")}
      />
    </NodeViewWrapper>
  );
}
const AttachmentImage = Node.create({
  name: "attachmentImage",
  group: "block",
  atom: true,
  addAttributes: () => ({
    attachmentId: { default: null },
    alt: { default: "" },
  }),
  parseHTML: () => [],
  renderHTML: () => ["span", { "data-knowledge-image": "private" }],
  addNodeView: () => ReactNodeViewRenderer(ImageNode),
});
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  addAttributes: () => ({ kind: { default: "info" } }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    { ...HTMLAttributes, "data-callout": "true" },
    0,
  ],
});
const extensions = [
  TableKit.configure({ table: { resizable: true } }),
  Callout,
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: false, linkOnPaste: false },
  }),
  AttachmentImage,
];
export function KnowledgeRichEditor({
  value,
  onChange,
  disabled,
  attachments = [],
  onPasteImage,
}: {
  value?: KnowledgeContentNode;
  onChange?: (value: KnowledgeContentNode) => void;
  disabled?: boolean;
  attachments?: KnowledgeAttachment[];
  onPasteImage?: (file: File) => Promise<KnowledgeAttachment | undefined>;
}) {
  const { message } = App.useApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const editor = useEditor({
    extensions,
    content: value ?? emptyKnowledgeContent,
    editable: !disabled,
    editorProps: {
      handleDrop: (_view,event,moved) => {
        if(moved||disabled||!onPasteImage)return false;
        const file=Array.from(event.dataTransfer?.files??[]).find(f=>f.type.startsWith("image/"));if(!file)return false;
        event.preventDefault();void onPasteImage(file).then(f=>{if(f)editor?.chain().focus().insertContent({type:"attachmentImage",attrs:{attachmentId:f.id,alt:f.originalName}}).run();}).catch(e=>message.error((e as Error).message));return true;
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file || !onPasteImage || disabled) return false;
        event.preventDefault();
        void onPasteImage(file)
          .then((f) => {
            if (f)
              editor
                ?.chain()
                .focus()
                .insertContent({
                  type: "attachmentImage",
                  attrs: { attachmentId: f.id, alt: f.originalName },
                })
                .run();
          })
          .catch((e) => message.error((e as Error).message));
        return true;
      },
    },
    onUpdate: ({ editor }) =>
      onChange?.(editor.getJSON() as KnowledgeContentNode),
  });
  useEffect(() => {
    // Busy/read-only transitions do not change document content.
    if (editor) editor.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (
      editor &&
      JSON.stringify(editor.getJSON()) !==
        JSON.stringify(value ?? emptyKnowledgeContent)
    )
      editor.commands.setContent(value ?? emptyKnowledgeContent, {
        emitUpdate: false,
      });
  }, [editor, value]);
  if (!editor) return null;
  return (
    <div className="knowledge-rich-editor">
      {!disabled && (
        <Space wrap size={4} className="knowledge-editor-toolbar">
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            加粗
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            斜体
          </Button>
          {([1, 2, 3] as const).map((level) => (
            <Button
              key={level}
              size="small"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level }).run()
              }
            >
              H{level}
            </Button>
          ))}
          <Button
            size="small"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            表格
          </Button>
          <Button
            size="small"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "callout",
                  attrs: { kind: "info" },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "提示" }],
                    },
                  ],
                })
                .run()
            }
          >
            提示块
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            代码块
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            分割线
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            无序列表
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            有序列表
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            引用
          </Button>
          <Button
            size="small"
            onClick={() => {
              setHref("");
              setLinkOpen(true);
            }}
          >
            链接
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            移除链接
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().undo().run()}
          >
            撤销
          </Button>
          <Button
            size="small"
            onClick={() => editor.chain().focus().redo().run()}
          >
            重做
          </Button>
          <Select
            size="small"
            aria-label="插入私有图片"
            placeholder="插入已上传图片"
            value={undefined}
            style={{ width: 170 }}
            options={attachments
              .filter((file) => file.contentType.startsWith("image/"))
              .map((file) => ({ value: file.id, label: file.originalName }))}
            onChange={(id) =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "attachmentImage",
                  attrs: {
                    attachmentId: id,
                    alt:
                      attachments.find((file) => file.id === id)
                        ?.originalName ?? "",
                  },
                })
                .run()
            }
          />
        </Space>
      )}
      <EditorContent editor={editor} aria-label="页面正文" />
      <Modal
        title="插入链接"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        onOk={() => {
          try {
            const url = new URL(href);
            if (
              !["http:", "https:", "mailto:"].includes(url.protocol) ||
              /\s/.test(href)
            )
              throw new Error();
            editor.chain().focus().setLink({ href }).run();
            setLinkOpen(false);
          } catch {
            message.error("请输入 http、https 或 mailto 链接");
          }
        }}
      >
        <Input
          aria-label="链接地址"
          value={href}
          onChange={(event) => setHref(event.target.value)}
        />
      </Modal>
    </div>
  );
}
export function KnowledgeContent({
  content,
}: {
  content?: KnowledgeContentNode;
}) {
  let headingIndex = 0;
  const render = (node: KnowledgeContentNode, key: number): ReactNode => {
    const children = node.content?.map(render);
    if (node.type === "text") {
      let text: ReactNode = node.text;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = <strong>{text}</strong>;
        else if (mark.type === "italic") text = <em>{text}</em>;
        else if (mark.type === "strike") text = <s>{text}</s>;
        else if (mark.type === "underline") text = <u>{text}</u>;
        else if (mark.type === "code") text = <code>{text}</code>;
        else if (
          mark.type === "link" &&
          /^(https?:\/\/|mailto:)/i.test(String(mark.attrs?.href))
        )
          text = (
            <a
              href={String(mark.attrs?.href)}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {text}
            </a>
          );
      }
      return <span key={key}>{text}</span>;
    }
    switch (node.type) {
      case "doc":
        return <div key={key}>{children}</div>;
      case "table":
        return (
          <table key={key}>
            <tbody>{children}</tbody>
          </table>
        );
      case "tableRow":
        return <tr key={key}>{children}</tr>;
      case "tableCell":
        return (
          <td
            key={key}
            colSpan={Number(node.attrs?.colspan ?? 1)}
            rowSpan={Number(node.attrs?.rowspan ?? 1)}
          >
            {children}
          </td>
        );
      case "tableHeader":
        return (
          <th
            key={key}
            colSpan={Number(node.attrs?.colspan ?? 1)}
            rowSpan={Number(node.attrs?.rowspan ?? 1)}
          >
            {children}
          </th>
        );
      case "callout":
        return (
          <aside key={key} className="knowledge-callout">
            {children}
          </aside>
        );
      case "paragraph":
        return <p key={key}>{children}</p>;
      case "heading":
        return Number(node.attrs?.level) === 1 ? (
          <h1 id={`knowledge-heading-${headingIndex++}`} key={key}>
            {children}
          </h1>
        ) : Number(node.attrs?.level) === 3 ? (
          <h3 id={`knowledge-heading-${headingIndex++}`} key={key}>
            {children}
          </h3>
        ) : (
          <h2 id={`knowledge-heading-${headingIndex++}`} key={key}>
            {children}
          </h2>
        );
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={key} start={Number(node.attrs?.start ?? 1)}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={key}>{children}</li>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "codeBlock":
        return (
          <pre key={key}>
            <code>{children}</code>
          </pre>
        );
      case "hardBreak":
        return <br key={key} />;
      case "horizontalRule":
        return <hr key={key} />;
      case "attachmentImage":
        return (
          <PrivateKnowledgeImage
            key={key}
            id={String(node.attrs?.attachmentId)}
            alt={String(node.attrs?.alt ?? "")}
          />
        );
      default:
        return null;
    }
  };
  return (
    <div className="knowledge-content">{content && render(content, 0)}</div>
  );
}
