import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { ALLOWED_MODULE_CATEGORIES } from "@/lib/testConfig";
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
    await dispatch(updateQuestionBankQuestion({ id: item.id, payload: patch })).unwrap();
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page, limit: pagination.limit }));
  };

  const removeQuestion = async (id) => {
    if (!canManageQuestions) return;
    await dispatch(deleteQuestionBankQuestion(id)).unwrap();
    dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page, limit: pagination.limit }));
  };

  if (!canViewQuestionBank) {
    return <PermissionDenied action="access question bank" />;
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Question Bank Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {canManageQuestions ? (
              <>
                <Input placeholder="Create subject" value={subjectDraft} onChange={(e) => setSubjectDraft(e.target.value)} className="max-w-sm" />
                <Button
                  onClick={async () => {
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
                  }}
                >
                  Add Subject
                </Button>
              </>
            ) : null}
            <Badge variant="secondary">{subjects.length} Subjects</Badge>
            <Badge variant="secondary">{activeCount} Questions</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => (
          <Card key={subject.id} className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle className="text-lg">{subject.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-text-secondary">Total Questions: <span className="font-semibold text-text-primary">{subject.questionCount || 0}</span></p>
              <p className="text-xs text-text-secondary">Updated: {new Date(subject.lastUpdated || subject.updatedAt || subject.createdAt).toLocaleString()}</p>
              <div className="flex items-center gap-2">
                {canManageQuestions ? <Button size="sm" onClick={() => openAdd(subject)}>Add Questions</Button> : null}
                <Button size="sm" variant="outline" onClick={() => openView(subject)}>View Questions</Button>
                {canManageQuestions ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await dispatch(deleteQuestionSubject(subject.id)).unwrap();
                        toast.success("Subject deleted");
                        dispatch(fetchQuestionSubjects());
                      } catch (error) {
                        toast.error(error?.message || "Unable to delete subject");
                      }
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {addDialogOpen && canManageQuestions ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-dark/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-text-primary">Add Questions: {activeSubject?.name}</h2>
              <Button type="button" variant="ghost" onClick={() => setAddDialogOpen(false)}>Close</Button>
            </div>

            <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-5">
              <Tabs defaultValue="manual">
                <TabsList>
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                  <TabsTrigger value="bulk">Bulk Upload (JSON)</TabsTrigger>
                </TabsList>
                <TabsContent value="manual" className="space-y-4">
                  {manualQuestions.map((item, index) => (
                    <Card key={`manual-${index}`} className="rounded-xl border-border">
                      <CardContent className="space-y-3 pt-5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-text-primary">Question {index + 1}</p>
                          <Button type="button" size="sm" variant="destructive" onClick={() => removeQuestionRow(index)}>
                            Delete Question
                          </Button>
                        </div>
                        <Textarea placeholder="Question text" value={item.question} onChange={(e) => updateQuestion(index, { question: e.target.value })} />
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <Select value={item.type} onValueChange={(value) => updateQuestion(index, { type: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mcq">MCQ</SelectItem>
                              <SelectItem value="true_false">True/False</SelectItem>
                              <SelectItem value="fill_blank">Fill Blank</SelectItem>
                              <SelectItem value="paragraph">Paragraph</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={item.difficulty} onValueChange={(value) => updateQuestion(index, { difficulty: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="EASY">Easy</SelectItem>
                              <SelectItem value="MEDIUM">Medium</SelectItem>
                              <SelectItem value="HARD">Hard</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={item.category || ""} onValueChange={(value) => updateQuestion(index, { category: value })}>
                            <SelectTrigger><SelectValue placeholder="Module category" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {ALLOWED_MODULE_CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>{category}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-text-secondary">Marks</label>
                            <Input type="text" min={1} value={item.marks} onChange={(e) => updateQuestion(index, { marks: Number(e.target.value || 1) })} placeholder="Marks" />
                          </div>
                        </div>
                        <Input placeholder="Correct answer" value={String(item.correctAnswer || "")} onChange={(e) => updateQuestion(index, { correctAnswer: e.target.value })} />
                        <Input
                          type="url"
                          placeholder="Explanation video URL (optional)"
                          value={String(item.explanationVideoUrl || "")}
                          onChange={(e) => updateQuestion(index, { explanationVideoUrl: e.target.value })}
                        />
                        {item.type === "mcq" ? (
                          <div className="space-y-2">
                            {(item.options || []).map((option, optIdx) => (
                              <div key={`opt-${index}-${optIdx}`} className="flex items-center gap-2">
                                <Input
                                  placeholder={`Option ${optIdx + 1}`}
                                  value={option}
                                  onChange={(e) => {
                                    const next = [...(item.options || [])];
                                    next[optIdx] = e.target.value;
                                    updateQuestion(index, { options: next });
                                  }}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => removeOptionFromQuestion(index, optIdx)}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                            <Button type="button" size="sm" variant="outline" onClick={() => addOptionToQuestion(index)}>
                              Add Option
                            </Button>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                  <div className=" sticky bottom-0 flex gap-2 bg-card p-4">
                    <Button variant="outline" onClick={addQuestionRow}>Add Question Row</Button>
                    <Button onClick={saveManualQuestions}>Save Questions</Button>
                  </div>
                </TabsContent>
                <TabsContent value="bulk" className="space-y-3">
                  <p className="rounded-lg bg-muted p-3 text-xs text-text-secondary">
                    Bulk upload format must include: type, question, options, correctAnswer, marks, difficulty, topic.
                    Optional: category (Quantitative Aptitude, Logical Reasoning, or Verbal) for Module Test questions.
                    Topic will be saved as the selected subject name.
                  </p>
                  <Textarea className="min-h-72 font-mono text-xs" value={bulkJson} onChange={(e) => setBulkJson(e.target.value)} />
                  <Button onClick={saveBulkQuestions}>Upload JSON</Button>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      ) : null}

      {viewDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-dark/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-text-primary">Questions: {activeSubject?.name}</h2>
              <Button type="button" variant="destructive" size="sm" className="rounded-full" onClick={() => setViewDialogOpen(false)}>Close</Button>
            </div>

            <div className="max-h-[calc(90vh-72px)] space-y-3 overflow-y-auto p-5">
              <div className="grid gap-2 md:grid-cols-6">
                <Input placeholder="Search" value={filters.search} onChange={(e) => dispatch(setQuestionBankFilters({ search: e.target.value }))} />
                <Select value={filters.difficulty} onValueChange={(value) => dispatch(setQuestionBankFilters({ difficulty: value }))}>
                  <SelectTrigger><SelectValue placeholder="Difficulty" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Difficulty</SelectItem>
                    <SelectItem value="EASY">Easy</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HARD">Hard</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.type} onValueChange={(value) => dispatch(setQuestionBankFilters({ type: value }))}>
                  <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Type</SelectItem>
                    <SelectItem value="mcq">MCQ</SelectItem>
                    <SelectItem value="true_false">True/False</SelectItem>
                    <SelectItem value="fill_blank">Fill Blank</SelectItem>
                    <SelectItem value="paragraph">Paragraph</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.category || "all"} onValueChange={(value) => dispatch(setQuestionBankFilters({ category: value }))}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Category</SelectItem>
                    {ALLOWED_MODULE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="date" value={filters.fromDate} onChange={(e) => dispatch(setQuestionBankFilters({ fromDate: e.target.value }))} />
                <Input type="date" value={filters.toDate} onChange={(e) => dispatch(setQuestionBankFilters({ toDate: e.target.value }))} />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: 1, limit: pagination.limit }))}
                >
                  Apply Filters
                </Button>
              </div>

              <div className="max-h-[55vh] space-y-3 overflow-y-auto">
                {loading ? <p className="text-sm text-text-secondary">Loading questions...</p> : null}
                {questions.map((item) => (
                  <Card key={item.id} className="rounded-xl border-border">
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-text-primary">{item.prompt}</p>
                          <p className="text-xs text-text-secondary">{String(item.type || "").toLowerCase()} | {item.difficulty} | {item.marks} marks</p>
                          {item.category ? <Badge variant="outline" className="mt-1">{item.category}</Badge> : null}
                        </div>
                        {canManageQuestions ? <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => dispatch(toggleQuestionBankSelected(item.id))} /> : null}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPreviewItem(item)}>Preview</Button>
                        {canManageQuestions ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => saveInlineEdit(item, { isActive: item.isActive === false })}>
                              {item.isActive === false ? "Activate" : "Deactivate"}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => removeQuestion(item.id)}>Delete</Button>
                          </>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-text-secondary">{canManageQuestions ? `Selected: ${selected.length} questions` : `${questions.length} questions loaded`}</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={pagination.page <= 1}
                    onClick={() => dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page - 1, limit: pagination.limit }))}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-text-secondary">Page {pagination.page} / {pagination.totalPages}</span>
                  <Button
                    variant="outline"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => dispatch(fetchQuestionBankQuestions({ filters: { ...filters, subjectId: activeSubject.id }, page: pagination.page + 1, limit: pagination.limit }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-primary-dark/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">Question Preview</h2>
              <Button type="button" variant="ghost" onClick={() => setPreviewItem(null)}>Close</Button>
            </div>
            <div className="space-y-2 text-sm text-text-secondary">
              <p className="font-semibold text-text-primary">{previewItem.prompt}</p>
              <p>Type: {String(previewItem.type || "").toLowerCase()}</p>
              <p>Difficulty: {previewItem.difficulty}</p>
              <p>Marks: {previewItem.marks}</p>
              {previewItem.category ? <p>Category: {previewItem.category}</p> : null}
              <p>Correct: {String(previewItem.correctOption || previewItem.correctText || previewItem.correctBoolean || "-")}</p>
              {Array.isArray(previewItem.options) && previewItem.options.length > 0 ? (
                <div>
                  <p className="font-medium">Options</p>
                  <ul className="list-disc pl-5">
                    {previewItem.options.map((opt) => (
                      <li key={`${previewItem.id}-${opt}`}>{opt}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
