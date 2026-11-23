
# Learner Model – Feature Specification

## 1. Objective

Estimate concept-wise student mastery using multiple types
of learning evidence.

Each prediction represents one student, one concept and
one prediction point in the learning history.

## 2. Data Architecture

- Store individual student interactions as raw events.
- Preserve timestamps and student/session/concept IDs.
- Aggregate available observations into student-concept snapshots.
- Supply snapshots to the ANN for mastery prediction.
- Maintain historical snapshots and predictions.

## 3. ANN Input Features

### Performance
1. diagnostic_accuracy
2. practice_accuracy
3. transfer_score

### Metacognition
4. avg_confidence
5. confidence_calibration_error

### Conceptual Reasoning
6. explain_back_score
7. misconception_rate

### Learning Independence
8. independent_attempt_rate
9. hint_usage_rate
10. independent_retry_success

### Temporal Learning
11. delayed_recall_score

## 4. Feature Definitions

All ratio-based features use a range of 0–1 unless otherwise
specified.

- diagnostic_accuracy: Correct valid first diagnostic attempts
  divided by valid diagnostic questions.
- practice_accuracy: Correct valid first practice attempts
  divided by valid practice questions.
- transfer_score: Correct independent transfer attempts
  divided by valid independent transfer questions.
- avg_confidence: Mean reported confidence divided by 100.
- confidence_calibration_error: Mean absolute difference
  between normalized confidence and correctness.
- explain_back_score: Normalized backend explain-back evaluation.
- misconception_rate: Misconception-affected evaluated responses
  divided by evaluated responses.
- independent_attempt_rate: Questions attempted before assistance
  divided by eligible questions.
- hint_usage_rate: Questions using at least one hint divided
  by eligible questions.
- independent_retry_success: Successful independent retries
  divided by eligible independent retries.
- delayed_recall_score: Correct delayed assessments divided
  by valid delayed assessments.

## 5. Supporting Learner Analytics

- Learning responsiveness.
- Confidence trends.
- Help-seeking patterns.
- Concept-wise mastery history.
- Teaching-method effectiveness.
- Response-time patterns.

These analytics support learner profiling and adaptive decisions.
They are not automatically ANN inputs.

## 6. Data Handling Rules

1. Features are calculated per student and concept.
2. Preserve raw interaction records.
3. Use valid submitted observations.
4. Missing values must not be treated as zero.
5. Preserve observation counts.
6. Avoid duplicate counting of retries.
7. Transfer success must represent independent application.
8. Do not use future evidence in earlier predictions.
9. Confidence calibration requires multiple observations
   for meaningful interpretation.
10. Evaluate feature redundancy before final model training.

## 7. Model Output

The ANN predicts a continuous concept-wise mastery score
between 0 and 1.

The adaptive teaching policy uses mastery predictions and
supporting learner evidence to choose the next intervention.


## 8. Student-Concept Prediction Snapshot

### 8.1 Snapshot Definition

A snapshot represents the learning evidence available for
one student and one concept at a specific prediction time.

Multiple snapshots can exist for the same student and concept
as the student continues learning.

### 8.2 Snapshot Identity

Each snapshot contains:

- snapshot_id: Unique snapshot identifier.
- student_id: Student identifier.
- concept_id: Concept identifier.
- prediction_timestamp: Time when the snapshot is created.

### 8.3 Feature Values

The snapshot contains the 11 ANN candidate features defined
in Section 3.

Each feature must retain:

- Its calculated value.
- Number of valid observations.
- Whether the feature is available.

Missing feature values must remain distinguishable from
actual zero values.

### 8.4 Prediction-Time Rules

1. Only evidence available up to prediction_timestamp
   can be included.
2. Raw events must be retained separately.
3. A new snapshot is created when sufficient new learning
   evidence becomes available.
4. Previous snapshots must not be overwritten.
5. Future assessment results must never be used as
   earlier prediction inputs.

### 8.5 Prediction Output

Each prediction is associated with its snapshot_id,
student_id and concept_id.

The ANN produces a continuous mastery score between 0 and 1.

The independent target mastery label is maintained separately
for model training and evaluation.
