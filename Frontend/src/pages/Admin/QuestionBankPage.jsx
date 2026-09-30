import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { BookOpen, Eye, FilePlus2, Filter, Plus, Power, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { ALLOWED_MODULE_CATEGORIES } from "@/lib/testConfig";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { Callout, DetailList, EmptyState, FormField, Modal, PageHeader, PaginationBar, SearchInput, SectionCard, StatTile, StatusBadge } from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

const TYPE_LABEL = { mcq: "MCQ", true_false: "True/False", fill_blank: "Fill Blank", paragraph: "Paragraph" };
const DIFFICULTY_TONE = { EASY: "success", MEDIUM: "warning", HARD: "danger" };
const typeLabel = (value) => TYPE_LABEL[String(value || "").toLowerCase()] || String(value || "").replace(/_/g, " ").toLowerCase();

import {
  createQuestionBankQuestion,
  createQuestionSubject,
  deleteQuestionSubject,
  deleteQuestionBankQuestion,
  fetchQuestionBankQuestions,
  fetchQuestionSubjects,
  importQuestionBankQuestions,
  setQuestionBankFilters,
  toggleQuestionBankSelected,
  updateQuestionBankQuestion,
} from "@/features/Admin/questionBankSlice";

const defaultQuestion = {
  type: "mcq",
  question: "",
  options: ["", ""],
  correctAnswer: "",
  marks: 1,
  difficulty: "MEDIUM",
  category: "",
  explanationVideoUrl: "",
};

const bulkUploadTemplate = JSON.stringify(
  [
    {
      type: "mcq",
      question: "",
      options: ["", ""],
      correctAnswer: "",
      marks: 1,
      difficulty: "MEDIUM",
      category: "",
      topic: "",
      explanationVideoUrl: "",
    },
  ],
  null,
  2
);

export default function QuestionBankPage() {
  const dispatch = useDispatch();
  const { subjects, questions, selected, filters, loading, pagination } = useSelector((state) => state.questionBank);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [activeSubject, setActiveSubject] = useState(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [bulkJson, setBulkJson] = useState(bulkUploadTemplate);
  const [manualQuestions, setManualQuestions] = useState([{ ...defaultQuestion }]);
  const canManageQuestions = usePermission(ADMIN_PERMISSIONS.MANAGE_QUESTIONS);
  const canViewQuestionBank = usePermission(ADMIN_PERMISSIONS.VIEW_QUESTION_BANK) || canManageQuestions;

  useEffect(() => {
    if (!canViewQuestionBank) return;
    dispatch(fetchQuestionSubjects());
  }, [canViewQuestionBank, dispatch]);

  useEffect(() => {
    if (!canViewQuestionBank || !viewDialogOpen || !activeSubject?.id) return;
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page, limit: pagination.limit }));
  }, [canViewQuestionBank, dispatch, viewDialogOpen, activeSubject?.id, filters, pagination.page, pagination.limit]);

  const activeCount = useMemo(() => subjects.reduce((sum, item) => sum + Number(item.questionCount || 0), 0), [subjects]);

  const updateQuestion = (index, patch) => {
    setManualQuestions((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const removeQuestionRow = (index) => {
    setManualQuestions((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length > 0 ? next : [{ ...defaultQuestion }];
    });
  };

  const addOptionToQuestion = (index) => {
    setManualQuestions((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, options: [...(item.options || []), ""] } : item))
    );
  };

  const removeOptionFromQuestion = (index, optionIndex) => {
    setManualQuestions((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const filtered = (item.options || []).filter((_, i) => i !== optionIndex);
        return {
          ...item,
          options: filtered.length >= 2 ? filtered : ["", ""],
        };
      })
    );
  };

  const addQuestionRow = () => setManualQuestions((prev) => [...prev, { ...defaultQuestion }]);

  const saveManualQuestions = async () => {
    if (!canManageQuestions || !activeSubject?.id) return;

    const validItems = manualQuestions.filter((item) => String(item.question || "").trim());
    if (validItems.length === 0) {
      toast.error("Add at least one valid question");
      return;
    }

    for (const item of validItems) {
      await dispatch(
        createQuestionBankQuestion({
          ...item,
          subjectId: activeSubject.id,
        })
      );
    }

    toast.success("Questions added to bank");
    setManualQuestions([{ ...defaultQuestion }]);
    setBulkJson(bulkUploadTemplate);
    setAddDialogOpen(false);
    dispatch(fetchQuestionSubjects());
  };

  const saveBulkQuestions = async () => {
    if (!canManageQuestions || !activeSubject?.id) return;
    let parsed;

    try {
      parsed = JSON.parse(bulkJson);
    } catch {
      toast.error("Invalid JSON format");
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      toast.error("Upload must be a non-empty JSON array");
      return;
    }

    const normalized = parsed.map((item) => ({
      ...item,
      subjectId: activeSubject.id,
      topic: activeSubject?.name || "",
    }));
    await dispatch(importQuestionBankQuestions({ items: normalized })).unwrap();
    toast.success("Bulk upload completed");
    setBulkJson(bulkUploadTemplate);
    setAddDialogOpen(false);
    dispatch(fetchQuestionSubjects());
  };

  const openAdd = (subject) => {
    if (!canManageQuestions) return;
    setActiveSubject(subject);
    setAddDialogOpen(true);
  };

  const openView = (subject) => {
    if (!canViewQuestionBank) return;
    setActiveSubject(subject);
    dispatch(setQuestionBankFilters({ subjectId: subject.id }));
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: subject.id }, page: 1, limit: pagination.limit }));
    setViewDialogOpen(true);
  };

  const saveInlineEdit = async (item, patch) => {
    if (!canManageQuestions) return;
    try {
      await dispatch(updateQuestionBankQuestion({ id: item.id, payload: patch })).unwrap();
    } catch (error) {
      toast.error(error?.message || "Unable to update question");
      return;
    }
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page, limit: pagination.limit }));
  };

  const removeQuestion = async (id) => {
    if (!canManageQuestions) return;
    try {
      await dispatch(deleteQuestionBankQuestion(id)).unwrap();
    } catch (error) {
      toast.error(error?.message || "Unable to delete question");
      return;
    }
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page, limit: pagination.limit }));
  };

  const createSubject = async () => {
    if (!canManageQuestions) return;
    const name = String(subjectDraft || "").trim();
    if (!name) return;

    const duplicate = subjects.some((item) => String(item.name || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      toast.error("Subject already exists");
      return;
    }

    await dispatch(createQuestionSubject({ name })).unwrap();
    setSubjectDraft("");
    dispatch(fetchQuestionSubjects());
  };

  const deleteSubject = async (subject) => {
    if (!canManageQuestions) return;
    try {
      await dispatch(deleteQuestionSubject(subject.id)).unwrap();
      toast.success("Subject deleted");
      dispatch(fetchQuestionSubjects());
    } catch (error) {
      toast.error(error?.message || "Unable to delete subject");
    }
  };

  const fetchPage = (targetPage) =>
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: targetPage, limit: pagination.limit }));

  if (!canViewQuestionBank) {
    return <PermissionDenied action="access question bank" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question bank"
        description={canManageQuestions ? "Organise questions by subject, add them manually or in bulk, and reuse them across tests." : "Browse the question bank by subject."}
      />

      <div className={canManageQuestions ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]" : "grid gap-4 sm:grid-cols-2"}>
        <StatTile icon={BookOpen} label="Subjects" value={subjects.length} />
        <StatTile icon={FilePlus2} label="Questions" value={activeCount.toLocaleString()} tone="success" />
        {canManageQuestions ? (
        <SectionCard className="lg:self-stretch" bodyClassName="h-full">
          <form
            className="flex h-full flex-col justify-center gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              createSubject();
            }}
          >
            <FormField label="New subject" htmlFor="qb-subject-name" className="flex-1">
              <Input id="qb-subject-name" className={ui.field} placeholder="e.g. Quantitative Aptitude" value={subjectDraft} onChange={(e) => setSubjectDraft(e.target.value)} />
            </FormField>
            <Button type="submit" className={ui.btn} disabled={!subjectDraft.trim()}>
              <Plus className="size-4" />
              Add Subject
            </Button>
          </form>
        </SectionCard>
        ) : null}
      </div>

      {subjects.length === 0 ? (
        <EmptyState icon={BookOpen} title="No subjects yet" description={canManageQuestions ? "Create a subject above, then add questions to it." : "Subjects will appear here once they are created."} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject) => (
            <li key={subject.id} className={`${ui.cardInteractive} flex flex-col p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-text-primary">{subject.name}</h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Updated {new Date(subject.lastUpdated || subject.updatedAt || subject.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-semibold tabular-nums text-primary">
                  {subject.questionCount || 0}
                  <span className="sr-only"> questions</span>
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {canManageQuestions ? (
                  <Button className="h-9 rounded-lg" onClick={() => openAdd(subject)}>
                    <Plus className="size-4" />
                    Add Questions
                  </Button>
                ) : null}
                <Button variant="outline" className="h-9 rounded-lg" onClick={() => openView(subject)}>
                  <Eye className="size-4" />
                  View Questions
                </Button>
                {canManageQuestions ? (
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="ml-auto rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => setPendingDelete({ kind: "subject", target: subject })}
                    title="Delete subject"
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Delete subject {subject.name}</span>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={addDialogOpen && canManageQuestions}
        onOpenChange={setAddDialogOpen}
        size="xl"
        title={`Add questions: ${activeSubject?.name || ""}`}
        description="Enter questions one by one, or paste a JSON array for bulk upload."
      >
        <Tabs defaultValue="manual" className="gap-4">
          <TabsList className="h-10! w-full sm:w-fit">
            <TabsTrigger value="manual" className="px-4">Manual Entry</TabsTrigger>
            <TabsTrigger value="bulk" className="px-4">Bulk Upload (JSON)</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="space-y-4">
            {manualQuestions.map((item, index) => (
              <section key={`manual-${index}`} className="space-y-4 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-primary">Question {index + 1}</h3>
                  <Button type="button" variant="ghost" className="h-9 rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => removeQuestionRow(index)}>
                    <Trash2 className="size-4" />
                    Delete Question
                  </Button>
                </div>
                <FormField label="Question text" htmlFor={`qb-q-${index}-text`} required>
                  <Textarea id={`qb-q-${index}-text`} className="rounded-lg" value={item.question} onChange={(e) => updateQuestion(index, { question: e.target.value })} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Type" htmlFor={`qb-q-${index}-type`}>
                    <select id={`qb-q-${index}-type`} className="ui-select w-full" value={item.type} onChange={(e) => updateQuestion(index, { type: e.target.value })}>
                      <option value="mcq">MCQ</option>
                      <option value="true_false">True/False</option>
                      <option value="fill_blank">Fill Blank</option>
                      <option value="paragraph">Paragraph</option>
                    </select>
                  </FormField>
                  <FormField label="Difficulty" htmlFor={`qb-q-${index}-difficulty`}>
                    <select id={`qb-q-${index}-difficulty`} className="ui-select w-full" value={item.difficulty} onChange={(e) => updateQuestion(index, { difficulty: e.target.value })}>
                      <option value="EASY">Easy</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HARD">Hard</option>
                    </select>
                  </FormField>
                  <FormField label="Module category" htmlFor={`qb-q-${index}-category`}>
                    <select id={`qb-q-${index}-category`} className="ui-select w-full" value={item.category || ""} onChange={(e) => updateQuestion(index, { category: e.target.value })}>
                      <option value="">None</option>
                      {ALLOWED_MODULE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Marks" htmlFor={`qb-q-${index}-marks`}>
                    <Input id={`qb-q-${index}-marks`} type="text" inputMode="numeric" className={ui.field} value={item.marks} onChange={(e) => updateQuestion(index, { marks: Number(e.target.value || 1) })} />
                  </FormField>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Correct answer" htmlFor={`qb-q-${index}-answer`} required>
                    <Input id={`qb-q-${index}-answer`} className={ui.field} value={String(item.correctAnswer || "")} onChange={(e) => updateQuestion(index, { correctAnswer: e.target.value })} />
                  </FormField>
                  <FormField label="Explanation video URL" htmlFor={`qb-q-${index}-video`} hint="Optional">
                    <Input
                      id={`qb-q-${index}-video`}
                      type="url"
                      placeholder="https://"
                      className={ui.field}
                      value={String(item.explanationVideoUrl || "")}
                      onChange={(e) => updateQuestion(index, { explanationVideoUrl: e.target.value })}
                    />
                  </FormField>
                </div>
                {item.type === "mcq" ? (
                  <fieldset className="space-y-2">
                    <legend className="mb-1.5 text-sm font-medium text-text-primary">Options</legend>
                    {(item.options || []).map((option, optIdx) => (
                      <div key={`opt-${index}-${optIdx}`} className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-text-secondary" aria-hidden="true">
                          {String.fromCharCode(65 + optIdx)}
                        </span>
                        <Input
                          aria-label={`Option ${optIdx + 1}`}
                          placeholder={`Option ${optIdx + 1}`}
                          className={ui.field}
                          value={option}
                          onChange={(e) => {
                            const next = [...(item.options || [])];
                            next[optIdx] = e.target.value;
                            updateQuestion(index, { options: next });
                          }}
                        />
                        <Button type="button" variant="ghost" size="icon-lg" className="shrink-0 rounded-lg text-text-secondary" onClick={() => removeOptionFromQuestion(index, optIdx)}>
                          <X className="size-4" />
                          <span className="sr-only">Remove option {optIdx + 1}</span>
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => addOptionToQuestion(index)}>
                      <Plus className="size-4" />
                      Add Option
                    </Button>
                  </fieldset>
                ) : null}
              </section>
            ))}
            <div className="sticky -bottom-5 -mx-5 flex flex-wrap gap-2 border-t border-border bg-card px-5 py-3 sm:-mx-6 sm:px-6">
              <Button variant="outline" className={ui.btn} onClick={addQuestionRow}>
                <Plus className="size-4" />
                Add Question Row
              </Button>
              <Button className={ui.btn} onClick={saveManualQuestions}>Save Questions</Button>
            </div>
          </TabsContent>
          <TabsContent value="bulk" className="space-y-4">
            <Callout tone="info">
              Bulk upload format must include: type, question, options, correctAnswer, marks, difficulty, topic.
              Optional: category (Quantitative Aptitude, Logical Reasoning, or Verbal) for Module Test questions.
              Topic will be saved as the selected subject name.
            </Callout>
            <FormField label="JSON" htmlFor="qb-bulk-json">
              <Textarea id="qb-bulk-json" className="min-h-72 rounded-lg font-mono text-xs" value={bulkJson} onChange={(e) => setBulkJson(e.target.value)} />
            </FormField>
            <Button className={ui.btn} onClick={saveBulkQuestions}>
              <Upload className="size-4" />
              Upload JSON
            </Button>
          </TabsContent>
        </Tabs>
      </Modal>

      <Modal
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        size="2xl"
        title={`Questions: ${activeSubject?.name || ""}`}
        description={canManageQuestions ? `${selected.length} selected` : `${questions.length} questions loaded`}
        bodyClassName="space-y-4"
        footer={
          activeSubject ? (
            <PaginationBar
              className="w-full"
              page={pagination.page}
              pages={pagination.totalPages}
              disabled={loading}
              onPageChange={(next) => fetchPage(next)}
            />
          ) : null
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            fetchPage(1);
          }}
        >
          <SearchInput className="sm:col-span-2 lg:col-span-1" label="Search questions" placeholder="Search" value={filters.search} onChange={(e) => dispatch(setQuestionBankFilters({ search: e.target.value }))} />
          <select aria-label="Difficulty" className="ui-select w-full" value={filters.difficulty} onChange={(e) => dispatch(setQuestionBankFilters({ difficulty: e.target.value }))}>
            <option value="all">All Difficulty</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
          <select aria-label="Type" className="ui-select w-full" value={filters.type} onChange={(e) => dispatch(setQuestionBankFilters({ type: e.target.value }))}>
            <option value="all">All Type</option>
            <option value="mcq">MCQ</option>
            <option value="true_false">True/False</option>
            <option value="fill_blank">Fill Blank</option>
            <option value="paragraph">Paragraph</option>
          </select>
          <select aria-label="Category" className="ui-select w-full" value={filters.category || "all"} onChange={(e) => dispatch(setQuestionBankFilters({ category: e.target.value }))}>
            <option value="all">All Category</option>
            {ALLOWED_MODULE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <Input type="date" aria-label="From date" className={ui.field} value={filters.fromDate} onChange={(e) => dispatch(setQuestionBankFilters({ fromDate: e.target.value }))} />
          <Input type="date" aria-label="To date" className={ui.field} value={filters.toDate} onChange={(e) => dispatch(setQuestionBankFilters({ toDate: e.target.value }))} />
          <Button type="submit" variant="outline" className={ui.btn}>
            <Filter className="size-4" />
            Apply Filters
          </Button>
        </form>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <EmptyState icon={FilePlus2} title="No questions found" description="Add questions to this subject or loosen the filters." className="border-0 py-8" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {questions.map((item) => {
              const isSelected = selected.includes(item.id);
              return (
                <li key={item.id} className={`flex gap-3 p-4 transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                  {canManageQuestions ? (
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Select question: ${item.prompt}`}
                      checked={isSelected}
                      onCheckedChange={() => dispatch(toggleQuestionBankSelected(item.id))}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{item.prompt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="neutral">{typeLabel(item.type)}</StatusBadge>
                      <StatusBadge tone={DIFFICULTY_TONE[item.difficulty] || "neutral"}>{item.difficulty}</StatusBadge>
                      <StatusBadge tone="info">{item.marks} marks</StatusBadge>
                      {item.category ? <StatusBadge tone="neutral">{item.category}</StatusBadge> : null}
                      {item.isActive === false ? <StatusBadge tone="danger">Inactive</StatusBadge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-start">
                    <Button variant="outline" className="h-9 rounded-lg" onClick={() => setPreviewItem(item)}>
                      <Eye className="size-4" />
                      Preview
                    </Button>
                    {canManageQuestions ? (
                      <>
                        <Button variant="outline" className="h-9 rounded-lg" onClick={() => saveInlineEdit(item, { isActive: item.isActive === false })}>
                          <Power className="size-4" />
                          {item.isActive === false ? "Activate" : "Deactivate"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-9 rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={() => setPendingDelete({ kind: "question", target: item })}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <Modal open={Boolean(previewItem)} onOpenChange={(open) => !open && setPreviewItem(null)} size="lg" title="Question preview">
        {previewItem ? (
          <div className="space-y-5">
            <p className="text-base font-medium leading-7 text-text-primary">{previewItem.prompt}</p>
            {Array.isArray(previewItem.options) && previewItem.options.length > 0 ? (
              <ol className="space-y-2">
                {previewItem.options.map((opt, optIdx) => {
                  const isCorrect = String(previewItem.correctOption ?? "") === String(opt);
                  return (
                    <li
                      key={`${previewItem.id}-${opt}`}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${isCorrect ? "border-success/40 bg-success/5" : "border-border"}`}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-text-secondary">{String.fromCharCode(65 + optIdx)}</span>
                      <span className="flex-1 text-text-primary">{opt}</span>
                      {isCorrect ? <StatusBadge tone="success">Correct</StatusBadge> : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <DetailList
              columns={3}
              items={[
                { label: "Type", value: typeLabel(previewItem.type) },
                { label: "Difficulty", value: previewItem.difficulty },
                { label: "Marks", value: previewItem.marks },
                previewItem.category ? { label: "Category", value: previewItem.category } : null,
                { label: "Correct", value: String(previewItem.correctOption || previewItem.correctText || previewItem.correctBoolean || "-") },
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete?.kind === "subject" ? "Delete subject" : "Delete question"}
        description={
          pendingDelete?.kind === "subject"
            ? `Delete “${pendingDelete?.target?.name}” and remove it from your question bank? This cannot be undone.`
            : "Delete this question from the question bank? This cannot be undone."
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          const current = pendingDelete;
          setPendingDelete(null);
          if (current?.kind === "subject") await deleteSubject(current.target);
          else if (current?.target?.id) await removeQuestion(current.target.id);
        }}
      />
    </div>
  );
}
