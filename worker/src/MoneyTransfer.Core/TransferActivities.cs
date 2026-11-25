using Microsoft.Extensions.Logging;
using Temporalio.Activities;

namespace MoneyTransfer.Core;

/// <summary>
/// Placeholder transfer steps. Each one records which region ran it, which is what the demo shows.
/// </summary>
public class TransferActivities(string region)
{
    public string Region { get; } = region;

    [Activity(Names.Withdraw)]
    public StepResult Withdraw(StepInput input) => Run(Names.Withdraw, input);

    [Activity(Names.Deposit)]
    public StepResult Deposit(StepInput input) => Run(Names.Deposit, input);

    private StepResult Run(string step, StepInput input)
    {
        // Make API call here.

        var context = ActivityExecutionContext.Current;
        context.MetricMeter
            .CreateCounter<long>(AppMetricNames.TransferSteps.Name, description: AppMetricNames.TransferSteps.Description)
            .Add(1, new Dictionary<string, object> { ["step"] = step.ToLowerInvariant() });
        context.Logger.LogInformation(
            "{Step} ran in {Region} for {WorkflowId}", step, Region, context.Info.WorkflowId);

        return new StepResult(step, Region);
    }
}
