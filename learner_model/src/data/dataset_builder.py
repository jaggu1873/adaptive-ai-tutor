
"""
ANN Dataset Builder

Prepares student-concept snapshots for ANN training.

Responsibilities:
1. Create an independent assessment-based mastery target.
2. Select leakage-free input features.
3. Split data by student to prevent data leakage.
4. Impute missing values using training data only.
5. Standardize input features.
6. Save training, validation and test datasets.
"""

import json
import joblib
import numpy as np
import pandas as pd

from pathlib import Path
from sklearn.model_selection import GroupShuffleSplit
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler


PROJECT_ROOT = Path(__file__).resolve().parents[2]

INPUT_PATH = (
    PROJECT_ROOT / "data" / "processed"
    / "feature_snapshots.csv"
)

OUTPUT_DIR = (
    PROJECT_ROOT / "data" / "processed"
    / "dataset_splits"
)


# Nine learning indicators used as model inputs.
BASE_FEATURES = [
    "diagnostic_accuracy",
    "practice_accuracy",
    "avg_confidence",
    "confidence_calibration_error",
    "explain_back_score",
    "misconception_rate",
    "independent_attempt_rate",
    "hint_usage_rate",
    "independent_retry_success"
]

# Independent assessment evidence used to construct the target.
TARGET_COMPONENTS = [
    "transfer_score",
    "delayed_recall_score"
]

TARGET_COLUMN = "reference_mastery"

RANDOM_STATE = 42


def load_snapshots():

    if not INPUT_PATH.exists():
        raise FileNotFoundError(
            f"Snapshot file not found: {INPUT_PATH}\n"
            "Run snapshot_generator.py first."
        )

    df = pd.read_csv(INPUT_PATH)

    print("Loaded snapshots:", df.shape)

    return df


def build_target(df):

    """
    Reference mastery is the mean of independent transfer
    performance and delayed recall performance.

    These assessment columns are excluded from model inputs.
    """

    for column in TARGET_COMPONENTS:
        if column not in df.columns:
            raise ValueError(
                f"Missing target component: {column}"
            )

    if df[TARGET_COMPONENTS].isna().any().any():
        raise ValueError(
            "Missing target assessment values detected. "
            "Resolve them before building the dataset."
        )

    df[TARGET_COLUMN] = df[
        TARGET_COMPONENTS
    ].mean(axis=1)

    return df


def prepare_features(df):

    missing = [
        column for column in BASE_FEATURES
        if column not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing input features: {missing}"
        )

    X = df[BASE_FEATURES].copy()

    # Preserve whether a retry observation existed.
    # Missing retry performance is not equivalent to zero.
    availability_column = (
        "independent_retry_success_available"
    )

    if availability_column in df.columns:
        retry_available = (
            df[availability_column]
            .fillna(False)
            .astype(int)
        )
    else:
        retry_available = (
            df["independent_retry_success"]
            .notna()
            .astype(int)
        )

    X["retry_observation_available"] = (
        retry_available
    )

    # Ensure all input features are numeric.
    X = X.apply(pd.to_numeric, errors="coerce")

    return X


def split_by_student(X, y, groups):

    """
    Split students, not individual snapshots.

    This prevents snapshots belonging to the same student
    from appearing in different datasets.
    """

    first_split = GroupShuffleSplit(
        n_splits=1,
        test_size=0.30,
        random_state=RANDOM_STATE
    )

    train_idx, remaining_idx = next(
        first_split.split(X, y, groups)
    )

    X_train = X.iloc[train_idx]
    y_train = y.iloc[train_idx]

    X_remaining = X.iloc[remaining_idx]
    y_remaining = y.iloc[remaining_idx]

    remaining_groups = groups.iloc[remaining_idx]

    second_split = GroupShuffleSplit(
        n_splits=1,
        test_size=0.50,
        random_state=RANDOM_STATE
    )

    val_relative_idx, test_relative_idx = next(
        second_split.split(
            X_remaining,
            y_remaining,
            remaining_groups
        )
    )

    X_val = X_remaining.iloc[val_relative_idx]
    y_val = y_remaining.iloc[val_relative_idx]

    X_test = X_remaining.iloc[test_relative_idx]
    y_test = y_remaining.iloc[test_relative_idx]

    return (
        X_train, X_val, X_test,
        y_train, y_val, y_test
    )


def preprocess_features(
    X_train,
    X_val,
    X_test
):

    """
    Fit imputation and scaling on training data only.
    Apply the same transformations to validation/test data.
    """

    imputer = SimpleImputer(strategy="median")

    X_train_imputed = imputer.fit_transform(X_train)
    X_val_imputed = imputer.transform(X_val)
    X_test_imputed = imputer.transform(X_test)

    scaler = StandardScaler()

    X_train_scaled = scaler.fit_transform(
        X_train_imputed
    )

    X_val_scaled = scaler.transform(
        X_val_imputed
    )

    X_test_scaled = scaler.transform(
        X_test_imputed
    )

    return (
        X_train_scaled,
        X_val_scaled,
        X_test_scaled,
        imputer,
        scaler
    )



def save_datasets(
    X_train,
    X_val,
    X_test,
    y_train,
    y_val,
    y_test,
    student_ids,
    concept_ids,
    feature_names
):
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    datasets = {
        "train": (X_train, y_train),
        "validation": (X_val, y_val),
        "test": (X_test, y_test)
    }

    for name, (X, y) in datasets.items():

        result = pd.DataFrame(
            X,
            columns=feature_names,
            index=X.index
        )

        # Preserve student and concept identifiers.
        result.insert(
            0,
            "student_id",
            student_ids.loc[X.index].values
        )

        result.insert(
            1,
            "concept_id",
            concept_ids.loc[X.index].values
        )

        # Add target column.
        result.insert(
            2,
            TARGET_COLUMN,
            y.loc[X.index].values
        )

        result.to_csv(
            OUTPUT_DIR / f"{name}_dataset.csv",
            index=False
        )

    print("\nDatasets saved:")
    for name in datasets:
        print(f"- {name}_dataset.csv")


def main():

    print("\nANN DATASET BUILDER")
    print("===================")

    # 1. Load snapshots
    df = load_snapshots()

    required_columns = [
        "student_id",
        "concept_id"
    ] + TARGET_COMPONENTS

    missing = [
        col for col in required_columns
        if col not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing required columns: {missing}"
        )

    if df.duplicated(
        subset=["student_id", "concept_id"]
    ).any():
        raise ValueError(
            "Duplicate student-concept snapshots found."
        )

    # 2. Create independent target
    df = build_target(df)

    # 3. Prepare input features
    X = prepare_features(df)

    y = df[TARGET_COLUMN].astype(float)

    groups = df["student_id"]

    # 4. Split by student
    (
        X_train, X_val, X_test,
        y_train, y_val, y_test
    ) = split_by_student(X, y, groups)

    # 5. Preprocess using training data only
    (
        X_train_scaled,
        X_val_scaled,
        X_test_scaled,
        imputer,
        scaler
    ) = preprocess_features(
        X_train,
        X_val,
        X_test
    )

    # Preserve original row indexes for IDs.
    # Reset indexes on transformed arrays for output.
    X_train = pd.DataFrame(
        X_train_scaled,
        columns=X.columns,
        index=X_train.index
    )

    X_val = pd.DataFrame(
        X_val_scaled,
        columns=X.columns,
        index=X_val.index
    )

    X_test = pd.DataFrame(
        X_test_scaled,
        columns=X.columns,
        index=X_test.index
    )

    # 6. Save datasets
    save_datasets(
    X_train,
    X_val,
    X_test,
    y_train,
    y_val,
    y_test,
    df["student_id"],
    df["concept_id"],
    list(X.columns)
)

    # 7. Save preprocessing objects
    joblib.dump(
        {
            "imputer": imputer,
            "scaler": scaler,
            "feature_names": list(X.columns)
        },
        OUTPUT_DIR / "preprocessor.joblib"
    )

    # 8. Check student separation
    train_students = set(
        df.loc[X_train.index, "student_id"]
    )

    val_students = set(
        df.loc[X_val.index, "student_id"]
    )

    test_students = set(
        df.loc[X_test.index, "student_id"]
    )

    assert train_students.isdisjoint(val_students)
    assert train_students.isdisjoint(test_students)
    assert val_students.isdisjoint(test_students)

    # 9. Save metadata
    metadata = {
        "total_snapshots": int(len(df)),
        "unique_students": int(
            df["student_id"].nunique()
        ),
        "unique_concepts": int(
            df["concept_id"].nunique()
        ),
        "input_features": list(X.columns),
        "input_feature_count": len(X.columns),
        "target": TARGET_COLUMN,
        "target_components": TARGET_COMPONENTS,
        "split_method": "GroupShuffleSplit by student",
        "random_state": RANDOM_STATE,
        "train_students": len(train_students),
        "validation_students": len(val_students),
        "test_students": len(test_students),
        "train_snapshots": len(X_train),
        "validation_snapshots": len(X_val),
        "test_snapshots": len(X_test)
    }

    with open(
        OUTPUT_DIR / "dataset_metadata.json",
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            metadata,
            file,
            indent=4
        )

    # 10. Print summary
    print("\nDATASET BUILDING COMPLETED")
    print("==========================")

    print("Total snapshots:", len(df))
    print("Unique students:", df["student_id"].nunique())
    print("Concepts:", df["concept_id"].nunique())

    print("\nInput feature count:", len(X.columns))
    print("Input features:", list(X.columns))

    print("\nTarget:", TARGET_COLUMN)
    print("Target range:",
          round(float(y.min()), 3),
          "to",
          round(float(y.max()), 3))

    print("\nDataset split:")

    print(
        "Training:",
        len(X_train),
        "snapshots |",
        len(train_students),
        "students"
    )

    print(
        "Validation:",
        len(X_val),
        "snapshots |",
        len(val_students),
        "students"
    )

    print(
        "Testing:",
        len(X_test),
        "snapshots |",
        len(test_students),
        "students"
    )

    print("\nStudent leakage check: PASSED")
    print("Preprocessing: fitted on training data only")
    print("Missing retry values: imputed using training median")
    print("\nOutput directory:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
