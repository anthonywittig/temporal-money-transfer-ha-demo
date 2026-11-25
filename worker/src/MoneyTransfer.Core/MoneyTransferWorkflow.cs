using Temporalio.Common;
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
        meter.CreateCounter<long>(AppMetricNames.TransfersStarted.Name, description: AppMetricNames.TransfersStarted.Description).Add(1);

        var withdraw = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Withdraw(new StepInput(input.TransferId, input.FromAccount, input.Amount)),
            StepOptions);
        Workflow.UpsertTypedSearchAttributes(TransferSearchAttributes.WithdrawRegion.ValueSet(withdraw.Region));

        await Workflow.DelayAsync(Names.PostWithdrawDelay);

        var deposit = await Workflow.ExecuteActivityAsync(
            (TransferActivities a) => a.Deposit(new StepInput(input.TransferId, input.ToAccount, input.Amount)),
            StepOptions);
        Workflow.UpsertTypedSearchAttributes(
            TransferSearchAttributes.DepositRegion.ValueSet(deposit.Region),
            TransferSearchAttributes.CrossRegion.ValueSet(withdraw.Region != deposit.Region));

        meter.CreateCounter<long>(AppMetricNames.TransfersCompleted.Name, description: AppMetricNames.TransfersCompleted.Description).Add(1);

        return new TransferResult(input.TransferId, withdraw, deposit);
    }
}
