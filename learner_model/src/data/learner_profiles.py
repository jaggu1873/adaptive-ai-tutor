
"""
Synthetic Learner Profile Generator

Creates diverse virtual learners with different initial
knowledge, learning behaviour, confidence and retention
characteristics.
"""

import numpy as np
import pandas as pd


def generate_learner_profiles(
    number_of_learners: int = 1000,
    seed: int = 42
) -> pd.DataFrame:
    """
    Generate a population of synthetic learner profiles.

    Parameters
    ----------
    number_of_learners : int
        Number of virtual learners to generate.

    seed : int
        Random seed for reproducibility.

    Returns
    -------
    pd.DataFrame
        One row per learner, containing latent learner
        characteristics.
    """

    if number_of_learners <= 0:
        raise ValueError("number_of_learners must be positive.")

    rng = np.random.default_rng(seed)

    profiles = []

    for i in range(number_of_learners):

        profile = {
            "student_id": f"student_{i + 1:04d}",

            # Starting knowledge
            "initial_knowledge": rng.beta(2.0, 2.0),

            # Learning characteristics
            "learning_rate": rng.uniform(0.02, 0.30),

            # Answering behaviour
            "guessing_probability": rng.uniform(0.05, 0.30),
            "slip_probability": rng.uniform(0.01, 0.20),

            # Conceptual difficulties
            "misconception_tendency": rng.beta(2.0, 5.0),

            # Long-term retention
            "forgetting_rate": rng.uniform(0.001, 0.08),

            # Response to teaching
            "intervention_responsiveness": rng.beta(2.0, 2.0),

            # Confidence behaviour
            "confidence_bias": np.clip(
                rng.normal(0.0, 0.18),
                -0.40,
                0.40
            ),

            # Assistance behaviour
            "help_seeking_tendency": rng.beta(2.0, 2.0)
        }

        profiles.append(profile)

    return pd.DataFrame(profiles)


if __name__ == "__main__":

    learners = generate_learner_profiles(
        number_of_learners=1000,
        seed=42
    )

    print("\nSYNTHETIC LEARNER PROFILES")
    print("-------------------------")

    print("\nFirst five learners:")
    print(learners.head())

    print("\nDataset shape:")
    print(learners.shape)

    print("\nStatistical summary:")
    print(learners.describe().round(3))

    print("\nUnique students:")
    print(learners["student_id"].nunique())
