import { MCQSingleQuestion } from "@/components/Students/test-engine/MCQSingleQuestion";
import { MCQMultiQuestion } from "@/components/Students/test-engine/MCQMultiQuestion";
import { TrueFalseQuestion } from "@/components/Students/test-engine/TrueFalseQuestion";
import { FillBlankQuestion } from "@/components/Students/test-engine/FillBlankQuestion";
import { ParagraphQuestion } from "@/components/Students/test-engine/ParagraphQuestion";

export function QuestionRenderer({ question, answer, disabled, onChange, paragraphWordLimit }) {
  if (!question) {
    return null;
  }

  if (question.type === "MCQ_MULTI") {
    return <MCQMultiQuestion question={question} answer={answer} onChange={onChange} disabled={disabled} />;
  }

  if (question.type === "TRUE_FALSE") {
    return <TrueFalseQuestion answer={answer} onChange={onChange} disabled={disabled} />;
  }

  if (question.type === "FILL_BLANK") {
    return <FillBlankQuestion answer={answer} onChange={onChange} disabled={disabled} />;
  }

  if (question.type === "PARAGRAPH") {
    return (
      <ParagraphQuestion
        answer={answer}
        onChange={onChange}
        disabled={disabled}
        wordLimit={Number(question.word_limit || paragraphWordLimit || 250)}
      />
    );
  }

  return <MCQSingleQuestion question={question} answer={answer} onChange={onChange} disabled={disabled} />;
}
