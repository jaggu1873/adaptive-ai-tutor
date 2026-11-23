
"""
Dataset Validator

Validates the prepared ANN training, validation and test datasets.
"""

import numpy as np
import pandas as pd

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = (
    PROJECT_ROOT / "data" / "processed"
    / "dataset_splits"
)

TARGET = "reference_mastery"

FILES = {
    "train": "train_dataset.csv",
    "validation": "validation_dataset.csv",
    "test": "test_dataset.csv"
}


def load_datasets():

    datasets = {}

    for name, filename in FILES.items():

        path = DATA_DIR / filename

        if not path.exists():
            raise FileNotFoundError(path)

        datasets[name] = pd.read_csv(path)

    return datasets


def validate_datasets(datasets):

    print("\nDATASET VALIDATION")
    print("==================")

    reference_columns = None
    student_sets = {}

    for name, df in datasets.items():

        print(f"\n{name.upper()} DATASET")
        print("------------------")

        print("Shape:", df.shape)

        assert "student_id" in df.columns
        assert TARGET in df.columns

        # Check feature consistency
        feature_columns = [
            col for col in df.columns
            if col not in ["student_id", TARGET]
        ]

        if reference_columns is None:
            reference_columns = feature_columns
        else:
            assert feature_columns == reference_columns, (
                "Feature columns do not match."
            )

        # Missing values
        assert not df.isna().any().any(), (
            f"Missing values in {name}"
        )

        # Infinite values
        numeric_data = df.select_dtypes(
            include=np.number
        )

        assert np.isfinite(
            numeric_data.to_numpy()
        ).all(), (
            f"Infinite values in {name}"
        )

        # Target range
        assert df[TARGET].between(0, 1).all(), (
            f"Target outside [0,1] in {name}"
        )

        # Duplicate student-concept records
        assert not df.duplicated(
            subset=["student_id", "concept_id"]
        ).any() if "concept_id" in df.columns else True

        student_sets[name] = set(df["student_id"])

        print("Rows:", len(df))
        print("Students:", df["student_id"].nunique())
        print("Input features:", len(feature_columns))
        print("Missing values: 0")
        print("Infinite values: 0")
        print(
            "Target range:",
            round(df[TARGET].min(), 4),
            "to",
            round(df[TARGET].max(), 4)
        )

    # Student leakage check
    assert student_sets["train"].isdisjoint(
        student_sets["validation"]
    )

    assert student_sets["train"].isdisjoint(
        student_sets["test"]
    )

    assert student_sets["validation"].isdisjoint(
        student_sets["test"]
    )

    print("\nSTUDENT LEAKAGE CHECK: PASSED")

    # Feature statistics
    print("\nTRAINING FEATURE STATISTICS")
    print("---------------------------")

    print(
        datasets["train"][reference_columns]
        .describe()
        .round(3)
        .to_string()
    )

    print("\nTARGET DISTRIBUTION")

    for name, df in datasets.items():

        print(
            name,
            "mean =", round(df[TARGET].mean(), 3),
            "| std =", round(df[TARGET].std(), 3)
        )

    print("\nALL DATASET VALIDATION CHECKS PASSED")


if __name__ == "__main__":

    datasets = load_datasets()

    validate_datasets(datasets)
