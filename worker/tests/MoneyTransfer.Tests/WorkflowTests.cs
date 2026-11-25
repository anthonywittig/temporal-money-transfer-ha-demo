using MoneyTransfer.Core;
using Temporalio.Api.Enums.V1;
using Temporalio.Client;
using Temporalio.Testing;
using Temporalio.Worker;
using Xunit;

using static MoneyTransfer.Tests.Helpers;

namespace MoneyTransfer.Tests;

public class WorkflowTests
{
    private static TemporalWorker NewWorker(ITemporalClient client, string taskQueue, string region) =>
        new(client, new TemporalWorkerOptions(taskQueue)
            .AddWorkflow<MoneyTransferWorkflow>()
            .AddAllActivities(new TransferActivities(region)));

    [Fact]
    public async Task Transfer_completes_withdraw_then_deposit()
    {
        await using var env = await StartEnvAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t1", "alice", "bob", 25m)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));
            var result = await handle.GetResultAsync();

            Assert.Equal("t1", result.TransferId);
            Assert.Equal(Names.Withdraw, result.Withdraw.Step);
            Assert.Equal(Names.Deposit, result.Deposit.Step);
            Assert.Equal("region-a", result.Withdraw.Region);
            Assert.Equal("region-a", result.Deposit.Region);
            Assert.False((await handle.DescribeAsync()).TypedSearchAttributes.Get(TransferSearchAttributes.CrossRegion));
        });
    }

    [Fact]
    public async Task Deposit_waits_for_the_post_withdraw_delay()
    {
        await using var env = await StartEnvAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t2", "alice", "bob", 10m)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));
            await handle.GetResultAsync();

            var events = (await handle.FetchHistoryAsync()).Events.ToList();
            var order = events
                .Where(e => e.EventType is EventType.ActivityTaskCompleted or EventType.TimerStarted)
                .Select(e => e.EventType)
                .ToList();
            Assert.Equal(
                new[] { EventType.ActivityTaskCompleted, EventType.TimerStarted, EventType.ActivityTaskCompleted },
                order);

            var timers = events
                .Where(e => e.EventType == EventType.TimerStarted)
                .Select(e => e.TimerStartedEventAttributes.StartToFireTimeout.ToTimeSpan())
                .ToList();
            Assert.Equal(new[] { Names.PostWithdrawDelay }, timers);
        });
    }

}
