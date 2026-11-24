using System.Text.Json.Serialization;

namespace MoneyTransfer.Core;

// JSON property names are pinned so the payload shape is stable regardless of
// serializer defaults (the dashboard, written in TypeScript, produces these inputs).

public record TransferInput(
    [property: JsonPropertyName("transferId")] string TransferId,
    [property: JsonPropertyName("fromAccount")] string FromAccount,
    [property: JsonPropertyName("toAccount")] string ToAccount,
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("pauseSeconds")] int? PauseSeconds = null);

public record StepInput(
    [property: JsonPropertyName("transferId")] string TransferId,
    [property: JsonPropertyName("account")] string Account,
    [property: JsonPropertyName("amount")] decimal Amount);

public record StepResult(
    [property: JsonPropertyName("step")] string Step,
    [property: JsonPropertyName("region")] string Region,
    [property: JsonPropertyName("applied")] bool Applied);

public record TransferResult(
    [property: JsonPropertyName("transferId")] string TransferId,
    [property: JsonPropertyName("withdraw")] StepResult Withdraw,
    [property: JsonPropertyName("deposit")] StepResult Deposit);

public static class Names
{
    public const string Workflow = "MoneyTransfer";
    public const string Withdraw = "Withdraw";
    public const string Deposit = "Deposit";
    public const string DefaultTaskQueue = "money-transfer";
    public const int DefaultPauseSeconds = 60;
}

/// <summary>
/// App metric names and descriptions. Every caller must use these so the workflow, the activities
/// and the startup pre-registration all create the identical instrument (same name, description
/// and unit), or the exporter emits duplicate series.
/// </summary>
public static class AppMetricNames
{
    public static readonly (string Name, string Description) TransfersStarted = ("transfers_started", "Transfers started");
    public static readonly (string Name, string Description) TransfersCompleted = ("transfers_completed", "Transfers completed");
    public static readonly (string Name, string Description) TransfersFailed = ("transfers_failed", "Transfers that failed");
    public static readonly (string Name, string Description) TransferSteps = ("transfer_steps", "Transfer steps executed");
}
