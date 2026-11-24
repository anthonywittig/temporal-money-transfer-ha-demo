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
    public const int DefaultPauseSeconds = 20;
}
