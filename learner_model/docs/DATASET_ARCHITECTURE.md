
# Learner Model – Dataset Architecture

## 1. Objective

Define how student learning interactions are stored,
aggregated and prepared for ANN training and prediction.

The architecture uses three logically separate datasets:
1. Raw interaction events.
2. Student-concept feature snapshots.
3. Independent mastery target labels.

## 2. Raw Interaction Events

Each student interaction is preserved as an individual event.

### Required fields

- event_id
- student_id
- session_id
- concept_id
- question_id (nullable when not applicable)
- event_type
- timestamp
- data (event-specific observations)

### Supported event types

- question_started
- answer_submitted
- hint_requested
- full_answer_requested
- explanation_submitted
- transfer_attempted
- delayed_assessment_submitted
- lesson_completed

Raw events must preserve original observations and must
not be replaced by aggregated features.

## 3. Student-Concept Feature Snapshots

A snapshot represents one student, one concept and one
prediction timestamp.

### Identity fields

- snapshot_id
- student_id
- concept_id
- prediction_timestamp

### ANN feature fields

1. diagnostic_accuracy
2. practice_accuracy
3. transfer_score
4. avg_confidence
5. confidence_calibration_error
6. explain_back_score
7. misconception_rate
8. independent_attempt_rate
9. hint_usage_rate
10. independent_retry_success
11. delayed_recall_score

### Additional metadata

For every feature, preserve:
- Calculated value.
- Valid observation count.
- Availability status.

Missing values must remain distinguishable from actual zeros.

Snapshots are historical records. Previous snapshots must
not be overwritten when new interactions occur.

## 4. Mastery Target Labels

Mastery targets are stored separately from ANN inputs.

Target evidence may include:
- Independent transfer assessments.
- Delayed recall assessments.
- Independent application performance.

The target-generation methodology will be finalized
in Phase 4.

Do not generate target mastery using a weighted formula
of the same ANN input features.

A target label may remain pending until sufficient
independent evidence is available.

## 5. Prediction Timeline

Each snapshot must contain only evidence available
at its prediction timestamp.

Future assessment results must never be included in
an earlier snapshot.

Target evidence is associated with the relevant snapshot
but remains separate from its ANN input features.

## 6. Dataset Splitting

Split the dataset by student identity.

- Training: 70%
- Validation: 15%
- Testing: 15%

No student may appear across multiple partitions.

Use separate random seeds for simulated student populations.

Fit preprocessing transformations using training data only.

Apply the fitted transformations to validation and testing data.

## 7. Data Quality Rules

1. Preserve raw events.
2. Use stable IDs across all datasets.
3. Keep timestamps for every interaction.
4. Calculate features per student and concept.
5. Preserve valid observation counts.
6. Represent missing observations explicitly.
7. Avoid counting retries as independent questions.
8. Prevent future-information leakage.
9. Keep target evidence separate from ANN inputs.
10. Maintain snapshot history.

## 8. Planned Implementation

Phase 3 will implement:
- Synthetic learner profiles.
- Interaction simulation.
- Raw event generation.
- Snapshot generation.
- Dataset export.

Phase 4 will implement:
- Independent mastery target generation.
- Label validation.
- Training dataset preparation.
