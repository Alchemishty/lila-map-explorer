"""The one error type for data-contract violations. First module in the pipeline order."""


class DataContractError(Exception):
    """Raised when the input data breaks a rule the pipeline depends on."""

    def __init__(self, problems: list[str]) -> None:
        lines = "".join(f"\n  - {problem}" for problem in problems)
        super().__init__(f"Build stopped: {len(problems)} problem(s) found in the data:{lines}")
        self.problems = problems
