// @vitest-environment jsdom

import {
  act,
  createRef,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import {
  RecipeEditorProvider,
  useRecipeEditor,
  useRegisterSaver,
} from "../recipe-editor-context";

const { render } = setupRenderHarness();

type EditorContext = ReturnType<typeof useRecipeEditor>;

type EditorHandle = {
  saveAll: EditorContext["saveAll"];
  getVersion: () => number;
  isDirty: () => boolean;
};

const EditorProbe = forwardRef<EditorHandle>(function EditorProbe(_props, ref) {
  const editor = useRecipeEditor();
  useImperativeHandle(ref, () => ({
    saveAll: editor.saveAll,
    getVersion: () => editor.recipe.version,
    isDirty: () => editor.anyDirty,
  }), [editor]);
  return <span>{editor.anyDirty ? "dirty" : "clean"}</span>;
});

function Contributor({
  id,
  contribution,
  onCommitted,
}: {
  id: string;
  contribution: {
    recipePatch?: Record<string, unknown>;
    sections?: Record<string, Array<Record<string, unknown>>>;
  };
  onCommitted: () => void;
}) {
  const [dirty, setDirty] = useState(true);

  useRegisterSaver(
    id,
    dirty,
    useCallback(async () => ({
      ...contribution,
      onCommitted: () => {
        onCommitted();
        setDirty(false);
      },
    }), [contribution, onCommitted]),
  );

  return null;
}

function renderEditor(
  basicsCommitted: () => void,
  maltsCommitted: () => void,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const editorRef = createRef<EditorHandle>();

  render(
    <QueryClientProvider client={queryClient}>
      <RecipeEditorProvider
        initialRecipe={{
          id: "00000000-0000-0000-0446-000000000001",
          name: "Before",
          status: "draft",
          version: 7,
        }}
      >
        <Contributor
          id="basics"
          contribution={{ recipePatch: { name: "After" } }}
          onCommitted={basicsCommitted}
        />
        <Contributor
          id="grain-bill"
          contribution={{
            sections: {
              recipe_malts: [{
                id: "00000000-0000-0000-0446-000000000002",
                malt_id: "00000000-0000-0000-0446-000000000003",
                weight_lbs: 42,
              }],
            },
          }}
          onCommitted={maltsCommitted}
        />
        <EditorProbe ref={editorRef} />
      </RecipeEditorProvider>
    </QueryClientProvider>,
  );

  return { editorRef, invalidateSpy };
}

describe("atomic recipe editor save", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("sends all dirty contributions in one version-checked RPC", async () => {
    const basicsCommitted = vi.fn();
    const maltsCommitted = vi.fn();
    rpcMock.mockResolvedValue({ data: { version: 8 }, error: null });
    const { editorRef, invalidateSpy } = renderEditor(basicsCommitted, maltsCommitted);

    await act(async () => {
      await editorRef.current!.saveAll();
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("save_recipe_aggregate_atomic", {
      p_recipe_id: "00000000-0000-0000-0446-000000000001",
      p_expected_version: 7,
      p_recipe_patch: { name: "After" },
      p_sections: {
        recipe_malts: [{
          id: "00000000-0000-0000-0446-000000000002",
          malt_id: "00000000-0000-0000-0446-000000000003",
          weight_lbs: 42,
        }],
      },
    });
    expect(basicsCommitted).toHaveBeenCalledOnce();
    expect(maltsCommitted).toHaveBeenCalledOnce();
    expect(editorRef.current!.getVersion()).toBe(8);
    expect(editorRef.current!.isDirty()).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["recipes", "00000000-0000-0000-0446-000000000001"],
      exact: true,
    });
  });

  it("keeps every contribution dirty when the transaction fails", async () => {
    const basicsCommitted = vi.fn();
    const maltsCommitted = vi.fn();
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Recipe version conflict: expected 7, found 8" },
    });
    const { editorRef, invalidateSpy } = renderEditor(basicsCommitted, maltsCommitted);

    await act(async () => {
      await expect(editorRef.current!.saveAll()).rejects.toThrow("version conflict");
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(basicsCommitted).not.toHaveBeenCalled();
    expect(maltsCommitted).not.toHaveBeenCalled();
    expect(editorRef.current!.getVersion()).toBe(7);
    expect(editorRef.current!.isDirty()).toBe(true);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
