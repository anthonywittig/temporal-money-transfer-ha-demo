using MoneyTransfer.Core;
using Temporalio.Api.Enums.V1;
using Temporalio.Client;
using Temporalio.Exceptions;
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
                RunWith(new TransferInput("t1", "alice", "bob", 25m, PreWithdrawSeconds: 0, PostWithdrawSeconds: 0)),
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
    public async Task Each_step_waits_for_its_own_delay()
    {
        await using var env = await StartEnvAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t2", "alice", "bob", 10m, PreWithdrawSeconds: 1, PostWithdrawSeconds: 2)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));
            await handle.GetResultAsync();

            var events = (await handle.FetchHistoryAsync()).Events.ToList();
            var order = events
                .Where(e => e.EventType is EventType.ActivityTaskCompleted or EventType.TimerStarted)
                .Select(e => e.EventType)
                .ToList();
            Assert.Equal(
                new[] { EventType.TimerStarted, EventType.ActivityTaskCompleted, EventType.TimerStarted, EventType.ActivityTaskCompleted },
                order);

            var timers = events
                .Where(e => e.EventType == EventType.TimerStarted)
                .Select(e => e.TimerStartedEventAttributes.StartToFireTimeout.ToTimeSpan())
                .ToList();
            Assert.Equal(new[] { TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2) }, timers);
        });
    }

    [Theory]
    [InlineData(0, "alice", "bob")]
    [InlineData(-5, "alice", "bob")]
    [InlineData(10, "alice", "alice")]
    public async Task Invalid_transfer_fails_without_withdraw(decimal amount, string from, string to)
    {
        await using var env = await StartEnvAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t3", from, to, amount)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));

            var ex = await Assert.ThrowsAsync<WorkflowFailedException>(() => handle.GetResultAsync());
            var failure = Assert.IsType<ApplicationFailureException>(ex.InnerException);
            Assert.Equal("InvalidTransfer", failure.ErrorType);

            var events = (await handle.FetchHistoryAsync()).Events;
            Assert.DoesNotContain(events, e => e.EventType == EventType.ActivityTaskScheduled);
        });
    }
}
