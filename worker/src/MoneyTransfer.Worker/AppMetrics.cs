using MoneyTransfer.Core;
using Temporalio.Runtime;

namespace MoneyTransfer.Worker;

/// <summary>
/// Emits every app counter once with value 0 at startup, using the same name, description and
/// labels the workflow and activity meters use later (so it is the same series, not a duplicate).
/// Google Managed Prometheus treats the first sample of a new counter series as its baseline, so
/// without this a region's first batch after a failover (the moment the demo is about) would not
/// show up in rate() charts.
/// </summary>
public static class AppMetrics
{
    public static void Preregister(TemporalRuntime runtime, string ns, string taskQueue)
    {
        var workflowMeter = runtime.MetricMeter.WithTags(new Dictionary<string, object>
        {
            ["namespace"] = ns,
            ["task_queue"] = taskQueue,
            ["workflow_type"] = Names.Workflow,
        });
        foreach (var (name, description) in new[]
                 {
                     AppMetricNames.TransfersStarted,
                     AppMetricNames.TransfersCompleted,
                 })
        {
            workflowMeter.CreateCounter<long>(name, description: description).Add(0);
        }

        foreach (var (activityType, step) in new[] { (Names.Withdraw, "withdraw"), (Names.Deposit, "deposit") })
        {
            runtime.MetricMeter
                .WithTags(new Dictionary<string, object>
                {
                    ["namespace"] = ns,
                    ["task_queue"] = taskQueue,
                    ["activity_type"] = activityType,
                })
                .CreateCounter<long>(AppMetricNames.TransferSteps.Name, description: AppMetricNames.TransferSteps.Description)
                .Add(0, new Dictionary<string, object> { ["step"] = step });
        }
    }
}
