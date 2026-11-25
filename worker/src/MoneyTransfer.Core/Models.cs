using System.Text.Json.Serialization;

namespace MoneyTransfer.Core;

// JSON property names are pinned so the payload shape is stable regardless of
// serializer defaults (the dashboard, written in TypeScript, produces these inputs).

public record TransferInput(
    [property: JsonPropertyName("transferId")] string TransferId,
    [property: JsonPropertyName("fromAccount")] string FromAccount,
    [property: JsonPropertyName("toAccount")] string ToAccount,
    [property: JsonPropertyName("amount")] decimal Amount);

public record StepInput(
    [property: JsonPropertyName("transferId")] string TransferId,
    [property: JsonPropertyName("account")] string Account,
    [property: JsonPropertyName("amount")] decimal Amount);

public record StepResult(
    [property: JsonPropertyName("step")] string Step,
    [property: JsonPropertyName("region")] string Region);

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
    /// <summary>Pause between the withdraw and the deposit, long enough for a failover to land in between.</summary>
    public static readonly TimeSpan PostWithdrawDelay = TimeSpan.FromSeconds(10);
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
    public static readonly (string Name, string Description) TransferSteps = ("transfer_steps", "Transfer steps executed");
}

/// <summary>
/// Custom search attributes (created on the namespace by Terraform, infra/main/temporal.tf). They let
/// you find transfers whose steps ran in different regions, e.g. the query <c>CrossRegion = true</c>.
/// </summary>
public static class TransferSearchAttributes
{
    public static readonly Temporalio.Common.SearchAttributeKey<string> WithdrawRegion =
        Temporalio.Common.SearchAttributeKey.CreateKeyword("WithdrawRegion");
    public static readonly Temporalio.Common.SearchAttributeKey<string> DepositRegion =
        Temporalio.Common.SearchAttributeKey.CreateKeyword("DepositRegion");
    public static readonly Temporalio.Common.SearchAttributeKey<bool> CrossRegion =
        Temporalio.Common.SearchAttributeKey.CreateBool("CrossRegion");

    public static readonly Temporalio.Common.SearchAttributeKey[] All = { WithdrawRegion, DepositRegion, CrossRegion };
}
