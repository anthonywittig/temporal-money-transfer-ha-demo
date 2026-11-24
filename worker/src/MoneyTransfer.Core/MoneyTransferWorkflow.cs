using Temporalio.Common;
using Temporalio.Exceptions;
using Temporalio.Workflows;

namespace MoneyTransfer.Core;

[Workflow(Names.Workflow)]
public class MoneyTransferWorkflow
{
    private static readonly ActivityOptions StepOptions = new()
    {
        StartToCloseTimeout = TimeSpan.FromSeconds(10),
        RetryPolicy = new RetryPolicy
        {
            InitialInterval = TimeSpan.FromSeconds(1),
            BackoffCoefficient = 2,
            MaximumInterval = TimeSpan.FromSeconds(10),
            NonRetryableErrorTypes = new[] { "InsufficientFunds" },
        },
    };

    [WorkflowRun]
    public async Task<TransferResult> RunAsync(TransferInput input)
    {
        var meter = Workflow.MetricMeter;
        var error = Validate(input);
        if (error != null)
        {
            meter.CreateCounter<long>("transfers_failed", description: "Transfers that failed").Add(1);
            throw new ApplicationFailureException(error, errorType: "InvalidTransfer", nonRetryable: true);
        }

        meter.CreateCounter<long>("transfers_started", description: "Transfers started").Add(1);

        var withdraw = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Withdraw(new StepInput(input.TransferId, input.FromAccount, input.Amount)),
            StepOptions);

        await Workflow.DelayAsync(TimeSpan.FromSeconds(input.PauseSeconds ?? Names.DefaultPauseSeconds));

        var deposit = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Deposit(new StepInput(input.TransferId, input.ToAccount, input.Amount)),
            StepOptions);

        meter.CreateCounter<long>("transfers_completed", description: "Transfers completed").Add(1);

        return new TransferResult(input.TransferId, withdraw, deposit);
    }

    internal static string? Validate(TransferInput input)
    {
        if (string.IsNullOrWhiteSpace(input.TransferId)) return "transferId is required";
        if (string.IsNullOrWhiteSpace(input.FromAccount) || string.IsNullOrWhiteSpace(input.ToAccount))
            return "fromAccount and toAccount are required";
        if (input.FromAccount == input.ToAccount) return "fromAccount and toAccount must differ";
        if (input.Amount <= 0) return "amount must be positive";
        if (input.PauseSeconds is < 0) return "pauseSeconds must not be negative";
        return null;
    }
}
