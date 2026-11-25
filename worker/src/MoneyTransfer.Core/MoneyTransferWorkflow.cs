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
        },
    };

    [WorkflowRun]
    public async Task<TransferResult> RunAsync(TransferInput input)
    {
        var meter = Workflow.MetricMeter;
        var error = Validate(input);
        if (error != null)
        {
            meter.CreateCounter<long>(AppMetricNames.TransfersFailed.Name, description: AppMetricNames.TransfersFailed.Description).Add(1);
            throw new ApplicationFailureException(error, errorType: "InvalidTransfer", nonRetryable: true);
        }

        meter.CreateCounter<long>(AppMetricNames.TransfersStarted.Name, description: AppMetricNames.TransfersStarted.Description).Add(1);

        // Each step waits for its own delay first. The caller (the dashboard) staggers these per transfer
        // so withdraws and deposits arrive as streams the failover can split.
        await Workflow.DelayAsync(TimeSpan.FromSeconds(input.PreWithdrawSeconds ?? Names.DefaultDelaySeconds));

        var withdraw = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Withdraw(new StepInput(input.TransferId, input.FromAccount, input.Amount)),
            StepOptions);
        Workflow.UpsertTypedSearchAttributes(TransferSearchAttributes.WithdrawRegion.ValueSet(withdraw.Region));

        await Workflow.DelayAsync(TimeSpan.FromSeconds(input.PostWithdrawSeconds ?? Names.DefaultDelaySeconds));

        var deposit = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Deposit(new StepInput(input.TransferId, input.ToAccount, input.Amount)),
            StepOptions);
        Workflow.UpsertTypedSearchAttributes(
            TransferSearchAttributes.DepositRegion.ValueSet(deposit.Region),
            TransferSearchAttributes.CrossRegion.ValueSet(withdraw.Region != deposit.Region));

        meter.CreateCounter<long>(AppMetricNames.TransfersCompleted.Name, description: AppMetricNames.TransfersCompleted.Description).Add(1);

        return new TransferResult(input.TransferId, withdraw, deposit);
    }

    internal static string? Validate(TransferInput input)
    {
        if (string.IsNullOrWhiteSpace(input.TransferId)) return "transferId is required";
        if (string.IsNullOrWhiteSpace(input.FromAccount) || string.IsNullOrWhiteSpace(input.ToAccount))
            return "fromAccount and toAccount are required";
        if (input.FromAccount == input.ToAccount) return "fromAccount and toAccount must differ";
        if (input.Amount <= 0) return "amount must be positive";
        if (input.PreWithdrawSeconds is < 0 || input.PostWithdrawSeconds is < 0) return "delays must not be negative";
        return null;
    }
}
