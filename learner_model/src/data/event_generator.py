
"""
Synthetic Student Interaction Event Generator

Generates realistic synthetic learning interactions using
hidden learner profiles.
"""

import json
import numpy as np
import pandas as pd

from pathlib import Path
from datetime import datetime, timedelta, timezone

from src.data.learner_profiles import generate_learner_profiles


PROJECT_ROOT = Path(__file__).resolve().parents[2]

CONCEPTS = [
    "artificial_neuron",
    "activation_function",
    "backpropagation"
]


def generate_events(
    profiles: pd.DataFrame,
    seed: int = 42
) -> list:

    rng = np.random.default_rng(seed)
    events = []
    event_counter = 0

    base_time = datetime(
        2026, 11, 23, 10, 0,
        tzinfo=timezone.utc
    )

    def add_event(
        student_id,
        session_id,
        concept_id,
        event_type,
        data
    ):
        nonlocal event_counter

        event_counter += 1

        events.append({
            "event_id": f"event_{event_counter:07d}",
            "student_id": student_id,
            "session_id": session_id,
            "concept_id": concept_id,
            "question_id": data.get("question_id"),
            "event_type": event_type,
            "timestamp": data["timestamp"],
            "data": data
        })

    for student_index, (_, learner) in enumerate(
        profiles.iterrows()
    ):

        student_id = learner["student_id"]

        for concept_index, concept_id in enumerate(CONCEPTS):

            knowledge = float(learner["initial_knowledge"])

            session_id = (
                f"{student_id}_{concept_id}_session1"
            )

            session_start = (
                base_time
                + timedelta(minutes=student_index * 2)
                + timedelta(hours=concept_index)
            )

            def make_timestamp(minutes):
                return (
                    session_start + timedelta(minutes=minutes)
                ).isoformat().replace("+00:00", "Z")

            # ====================================
            # 1. DIAGNOSTIC ASSESSMENT
            # ====================================

            for q in range(5):

                difficulty = rng.uniform(0.3, 0.8)

                effective_knowledge = np.clip(
                    knowledge - (difficulty - 0.5) * 0.2,
                    0, 1
                )

                probability_correct = (
                    effective_knowledge
                    * (1 - learner["slip_probability"])
                    + (1 - effective_knowledge)
                    * learner["guessing_probability"]
                )

                correct = rng.random() < probability_correct

                confidence = np.clip(
                    knowledge * 100
                    + learner["confidence_bias"] * 100
                    + rng.normal(0, 10),
                    0, 100
                )

                response_time = (
                    rng.uniform(15, 50)
                    * (1 + (1 - knowledge) * difficulty)
                )

                add_event(
                    student_id,
                    session_id,
                    concept_id,
                    "answer_submitted",
                    {
                        "question_id": f"diag_{q+1}",
                        "question_type": "diagnostic",
                        "difficulty": round(float(difficulty), 3),
                        "correct": bool(correct),
                        "confidence": round(float(confidence), 2),
                        "attempt_count": 1,
                        "response_time_sec": round(
                            float(response_time), 2
                        ),
                        "hint_count": 0,
                        "independent_attempt": True,
                        "misconception_detected": bool(
                            not correct
                            and rng.random()
                            < learner["misconception_tendency"]
                        ),
                        "timestamp": make_timestamp(q * 2)
                    }
                )

            # ====================================
            # 2. PRACTICE DURING TEACHING
            # ====================================

            for q in range(5):

                question_id = f"practice_{q+1}"

                hint_used = (
                    rng.random()
                    < learner["help_seeking_tendency"]
                    * (1 - knowledge) * 0.5
                )

                question_time = 15 + q * 5

                if hint_used:

                    add_event(
                        student_id,
                        session_id,
                        concept_id,
                        "hint_requested",
                        {
                            "question_id": question_id,
                            "hint_type": "conceptual",
                            "timestamp": make_timestamp(
                                question_time
                            )
                        }
                    )

                difficulty = rng.uniform(0.3, 0.8)

                effective_knowledge = np.clip(
                    knowledge - (difficulty - 0.5) * 0.2,
                    0, 1
                )

                probability_correct = (
                    effective_knowledge
                    * (1 - learner["slip_probability"])
                    + (1 - effective_knowledge)
                    * learner["guessing_probability"]
                )

                correct = rng.random() < probability_correct

                confidence = np.clip(
                    knowledge * 100
                    + learner["confidence_bias"] * 100
                    + rng.normal(0, 10),
                    0, 100
                )

                response_time = (
                    rng.uniform(15, 50)
                    * (1 + 1 - knowledge)
                )

                # First attempt
                add_event(
                    student_id,
                    session_id,
                    concept_id,
                    "answer_submitted",
                    {
                        "question_id": question_id,
                        "question_type": "practice",
                        "difficulty": round(float(difficulty), 3),
                        "correct": bool(correct),
                        "confidence": round(float(confidence), 2),
                        "attempt_count": 1,
                        "response_time_sec": round(
                            float(response_time), 2
                        ),
                        "hint_count": int(hint_used),
                        "independent_attempt": not hint_used,
                        "misconception_detected": bool(
                            not correct
                            and rng.random()
                            < learner["misconception_tendency"]
                        ),
                        "timestamp": make_timestamp(
                            question_time + 1
                        )
                    }
                )

                # Independent retry after hint and incorrect answer
                if hint_used and not correct:

                    retry_probability = (
                        knowledge
                        * (1 - learner["slip_probability"])
                        + (1 - knowledge)
                        * learner["guessing_probability"]
                    )

                    retry_correct = (
                        rng.random() < retry_probability
                    )

                    add_event(
                        student_id,
                        session_id,
                        concept_id,
                        "answer_submitted",
                        {
                            "question_id": question_id,
                            "question_type": "practice",
                            "difficulty": round(float(difficulty), 3),
                            "correct": bool(retry_correct),
                            "confidence": round(
                                float(confidence), 2
                            ),
                            "attempt_count": 2,
                            "response_time_sec": round(
                                float(rng.uniform(15, 45)), 2
                            ),
                            "hint_count": 1,
                            "independent_attempt": True,
                            "misconception_detected": bool(
                                not retry_correct
                                and rng.random()
                                < learner["misconception_tendency"]
                            ),
                            "timestamp": make_timestamp(
                                question_time + 2
                            )
                        }
                    )

                # Learning improvement after practice
                knowledge += (
                    learner["learning_rate"]
                    * learner["intervention_responsiveness"]
                    * (1 - knowledge)
                    * 0.35
                )

                knowledge = float(
                    np.clip(knowledge, 0, 1)
                )

            # ====================================
            # 3. EXPLAIN-BACK
            # ====================================

            explain_score = np.clip(
                knowledge + rng.normal(0, 0.12),
                0, 1
            )

            add_event(
                student_id,
                session_id,
                concept_id,
                "explanation_submitted",
                {
                    "question_id": "explain_001",
                    "evaluation_score": round(
                        float(explain_score), 3
                    ),
                    "timestamp": make_timestamp(50)
                }
            )

            # ====================================
            # 4. INDEPENDENT TRANSFER
            # ====================================

            for q in range(3):

                difficulty = rng.uniform(0.5, 0.9)

                effective_knowledge = np.clip(
                    knowledge - (difficulty - 0.5) * 0.2,
                    0, 1
                )

                probability_correct = (
                    effective_knowledge
                    * (1 - learner["slip_probability"])
                    + (1 - effective_knowledge)
                    * learner["guessing_probability"]
                )

                correct = rng.random() < probability_correct

                confidence = np.clip(
                    knowledge * 100
                    + learner["confidence_bias"] * 100
                    + rng.normal(0, 10),
                    0, 100
                )

                add_event(
                    student_id,
                    session_id,
                    concept_id,
                    "answer_submitted",
                    {
                        "question_id": f"transfer_{q+1}",
                        "question_type": "transfer",
                        "difficulty": round(float(difficulty), 3),
                        "correct": bool(correct),
                        "confidence": round(float(confidence), 2),
                        "attempt_count": 1,
                        "response_time_sec": round(
                            float(rng.uniform(20, 60)), 2
                        ),
                        "hint_count": 0,
                        "independent_attempt": True,
                        "misconception_detected": bool(
                            not correct
                            and rng.random()
                            < learner["misconception_tendency"]
                        ),
                        "timestamp": make_timestamp(60 + q * 2)
                    }
                )

            # ====================================
            # 5. DELAYED RECALL AFTER 24 HOURS
            # ====================================

            retained_knowledge = knowledge * np.exp(
                -learner["forgetting_rate"]
            )

            delayed_session = f"{session_id}_delayed"

            delayed_start = session_start + timedelta(days=1)

            for q in range(3):

                probability_correct = (
                    retained_knowledge
                    * (1 - learner["slip_probability"])
                    + (1 - retained_knowledge)
                    * learner["guessing_probability"]
                )

                correct = rng.random() < probability_correct

                confidence = np.clip(
                    retained_knowledge * 100
                    + learner["confidence_bias"] * 100
                    + rng.normal(0, 10),
                    0, 100
                )

                delayed_timestamp = (
                    delayed_start + timedelta(minutes=q * 2)
                ).isoformat().replace("+00:00", "Z")

                add_event(
                    student_id,
                    delayed_session,
                    concept_id,
                    "answer_submitted",
                    {
                        "question_id": f"delayed_{q+1}",
                        "question_type": "delayed",
                        "difficulty": round(
                            float(rng.uniform(0.4, 0.8)), 3
                        ),
                        "correct": bool(correct),
                        "confidence": round(float(confidence), 2),
                        "attempt_count": 1,
                        "response_time_sec": round(
                            float(rng.uniform(20, 60)), 2
                        ),
                        "hint_count": 0,
                        "independent_attempt": True,
                        "misconception_detected": bool(
                            not correct
                            and rng.random()
                            < learner["misconception_tendency"]
                        ),
                        "timestamp": delayed_timestamp
                    }
                )

    # Chronological ordering
    events.sort(key=lambda event: event["timestamp"])

    return events


if __name__ == "__main__":

    profiles = generate_learner_profiles(
        number_of_learners=1000,
        seed=42
    )

    events = generate_events(
        profiles,
        seed=43
    )

    raw_folder = PROJECT_ROOT / "data" / "raw"
    generated_folder = PROJECT_ROOT / "data" / "generated"

    raw_folder.mkdir(parents=True, exist_ok=True)
    generated_folder.mkdir(parents=True, exist_ok=True)

    profiles.to_csv(
        generated_folder / "learner_profiles.csv",
        index=False
    )

    with open(
        raw_folder / "raw_events.jsonl",
        "w",
        encoding="utf-8"
    ) as file:

        for event in events:
            file.write(json.dumps(event) + "\n")

    event_types = pd.Series(
        [event["event_type"] for event in events]
    )

    print("\nEVENT GENERATION COMPLETED")
    print("--------------------------")

    print("Total learners:", profiles["student_id"].nunique())
    print("Total concepts:", len(CONCEPTS))
    print("Total events:", len(events))

    print("\nEvent type distribution:")
    print(event_types.value_counts())

    print("\nGenerated files:")
    print("data/generated/learner_profiles.csv")
    print("data/raw/raw_events.jsonl")

    print("\nSample event:")
    print(json.dumps(events[0], indent=2))
