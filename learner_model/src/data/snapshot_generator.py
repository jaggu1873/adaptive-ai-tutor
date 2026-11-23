
"""
Student-Concept Snapshot Generator

Converts raw interaction events into aggregated ANN features.
"""

import json
import numpy as np
import pandas as pd

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]

FEATURE_COLUMNS = [
    "diagnostic_accuracy",
    "practice_accuracy",
    "transfer_score",
    "avg_confidence",
    "confidence_calibration_error",
    "explain_back_score",
    "misconception_rate",
    "independent_attempt_rate",
    "hint_usage_rate",
    "independent_retry_success",
    "delayed_recall_score"
]


def load_events(file_path):

    events = []

    with open(file_path, "r", encoding="utf-8") as file:
        for line in file:
            events.append(json.loads(line))

    return pd.DataFrame(events)


def calculate_ratio(numerator, denominator):

    if denominator == 0:
        return np.nan

    return numerator / denominator


def generate_snapshots(events):

    snapshots = []

    grouped = events.groupby(
        ["student_id", "concept_id"],
        sort=True
    )

    for (student_id, concept_id), group in grouped:

        # ------------------------------------
        # Extract event-specific data
        # ------------------------------------

        answers = group[
            group["event_type"] == "answer_submitted"
        ].copy()

        explanations = group[
            group["event_type"] == "explanation_submitted"
        ].copy()

        answer_data = pd.json_normalize(
            answers["data"]
        )
        answer_data.index = answers.index

        explanation_data = pd.json_normalize(
            explanations["data"]
        )
        explanation_data.index = explanations.index

        answers = pd.concat(
            [answers.drop(columns="data"), answer_data],
            axis=1
        )

        # Remove duplicate column names created during JSON normalization
        answers = answers.loc[:, ~answers.columns.duplicated()]

        explanations = pd.concat(
            [explanations.drop(columns="data"), explanation_data],
            axis=1
        )

        explanations = explanations.loc[
            :, ~explanations.columns.duplicated()
        ]

        # ------------------------------------
        # Separate assessment types
        # ------------------------------------

        diagnostic = answers[
            answers["question_type"] == "diagnostic"
        ].copy()

        practice_all = answers[
            answers["question_type"] == "practice"
        ].copy()

        transfer = answers[
            answers["question_type"] == "transfer"
        ].copy()

        delayed = answers[
            answers["question_type"] == "delayed"
        ].copy()

        # Practice first attempts only
        practice = (
            practice_all.sort_values("attempt_count")
            .drop_duplicates("question_id", keep="first")
        )

        # ------------------------------------
        # Performance features
        # ------------------------------------

        diagnostic_accuracy = calculate_ratio(
            diagnostic["correct"].sum(),
            len(diagnostic)
        )

        practice_accuracy = calculate_ratio(
            practice["correct"].sum(),
            len(practice)
        )

        transfer_independent = transfer[
            transfer["independent_attempt"] == True
        ]

        transfer_score = calculate_ratio(
            transfer_independent["correct"].sum(),
            len(transfer_independent)
        )

        delayed_independent = delayed[
            delayed["independent_attempt"] == True
        ]

        delayed_recall_score = calculate_ratio(
            delayed_independent["correct"].sum(),
            len(delayed_independent)
        )

        # ------------------------------------
        # Metacognitive features
        # ------------------------------------

        # Use first attempts to avoid counting retries twice
        first_attempts = (
            answers.sort_values("attempt_count")
            .drop_duplicates("question_id", keep="first")
        )

        valid_confidence = first_attempts.dropna(
            subset=["confidence", "correct"]
        )

        normalized_confidence = (
            valid_confidence["confidence"] / 100
        )

        avg_confidence = (
            normalized_confidence.mean()
            if len(valid_confidence)
            else np.nan
        )

        confidence_calibration_error = (
            np.abs(
                normalized_confidence
                - valid_confidence["correct"].astype(float)
            ).mean()
            if len(valid_confidence)
            else np.nan
        )

        # ------------------------------------
        # Reasoning features
        # ------------------------------------

        explain_back_score = (
            explanation_data["evaluation_score"].mean()
            if len(explanation_data)
            else np.nan
        )

        valid_misconceptions = first_attempts[
            first_attempts["misconception_detected"].notna()
        ]

        misconception_rate = calculate_ratio(
            valid_misconceptions[
                "misconception_detected"
            ].sum(),
            len(valid_misconceptions)
        )

        # ------------------------------------
        # Learning independence features
        # ------------------------------------

        independent_attempt_rate = calculate_ratio(
            practice["independent_attempt"].sum(),
            len(practice)
        )

        hint_events = group[
            group["event_type"] == "hint_requested"
        ]

        hinted_questions = (
            hint_events["question_id"].nunique()
        )

        hint_usage_rate = calculate_ratio(
            hinted_questions,
            practice["question_id"].nunique()
        )

        # Retry attempts
        retry_attempts = practice_all[
            practice_all["attempt_count"] > 1
        ]

        independent_retries = retry_attempts[
            retry_attempts["independent_attempt"] == True
        ]

        independent_retry_success = calculate_ratio(
            independent_retries["correct"].sum(),
            len(independent_retries)
        )

        # ------------------------------------
        # Build feature values
        # ------------------------------------

        feature_values = {
            "diagnostic_accuracy": diagnostic_accuracy,
            "practice_accuracy": practice_accuracy,
            "transfer_score": transfer_score,
            "avg_confidence": avg_confidence,
            "confidence_calibration_error":
                confidence_calibration_error,
            "explain_back_score": explain_back_score,
            "misconception_rate": misconception_rate,
            "independent_attempt_rate":
                independent_attempt_rate,
            "hint_usage_rate": hint_usage_rate,
            "independent_retry_success":
                independent_retry_success,
            "delayed_recall_score": delayed_recall_score
        }

        # ------------------------------------
        # Observation counts
        # ------------------------------------

        observation_counts = {
            "diagnostic_accuracy": len(diagnostic),
            "practice_accuracy": len(practice),
            "transfer_score": len(transfer_independent),
            "avg_confidence": len(valid_confidence),
            "confidence_calibration_error": len(valid_confidence),
            "explain_back_score": len(explanations),
            "misconception_rate": len(valid_misconceptions),
            "independent_attempt_rate": len(practice),
            "hint_usage_rate": len(practice),
            "independent_retry_success": len(independent_retries),
            "delayed_recall_score": len(delayed_independent)
        }

        # ------------------------------------
        # Create snapshot
        # ------------------------------------

        snapshot = {
            "snapshot_id":
                f"{student_id}_{concept_id}_snapshot_001",

            "student_id": student_id,
            "concept_id": concept_id,

            **feature_values
        }

        for feature in FEATURE_COLUMNS:

            snapshot[f"{feature}_count"] = (
                observation_counts[feature]
            )

            snapshot[f"{feature}_available"] = (
                pd.notna(feature_values[feature])
            )

        snapshots.append(snapshot)

    return pd.DataFrame(snapshots)


if __name__ == "__main__":

    raw_path = (
        PROJECT_ROOT / "data" / "raw" / "raw_events.jsonl"
    )

    output_path = (
        PROJECT_ROOT / "data" / "processed"
        / "feature_snapshots.csv"
    )

    events = load_events(raw_path)

    snapshots = generate_snapshots(events)

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    snapshots.to_csv(
        output_path,
        index=False
    )

    print("\nSNAPSHOT GENERATION COMPLETED")
    print("-----------------------------")

    print("Total raw events:", len(events))
    print("Total snapshots:", len(snapshots))
    print("Snapshot shape:", snapshots.shape)

    print("\nFeature availability:")

    for feature in FEATURE_COLUMNS:

        print(
            feature,
            "->",
            snapshots[feature].notna().sum(),
            "available"
        )

    print("\nMissing values:")
    print(snapshots[FEATURE_COLUMNS].isna().sum())

    print("\nObservation count for retry success:")
    print(
        snapshots["independent_retry_success_count"]
        .describe()
    )

    print("\nFirst five snapshots:")
    print(
        snapshots.head().to_string(index=False)
    )

    print("\nSaved to:", output_path)
