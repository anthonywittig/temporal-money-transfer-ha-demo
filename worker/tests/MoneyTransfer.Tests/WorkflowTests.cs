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
    private static TemporalWorker NewWorker(ITemporalClient client, string taskQueue, string region, Bank? bank = null) =>
        new(client, new TemporalWorkerOptions(taskQueue)
            .AddWorkflow<MoneyTransferWorkflow>()
            .AddAllActivities(new TransferActivities(bank ?? new Bank(), region)));

    [Fact]
    public async Task Transfer_completes_withdraw_then_deposit()
    {
        await using var env = await WorkflowEnvironment.StartTimeSkippingAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var result = await env.Client.ExecuteWorkflowAsync(
                RunWith(new TransferInput("t1", "alice", "bob", 25m)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));

            Assert.Equal("t1", result.TransferId);
            Assert.Equal(Names.Withdraw, result.Withdraw.Step);
            Assert.Equal(Names.Deposit, result.Deposit.Step);
            Assert.Equal("region-a", result.Withdraw.Region);
            Assert.Equal("region-a", result.Deposit.Region);
        });
    }

    [Fact]
    public async Task Deposit_waits_for_configured_pause()
    {
        await using var env = await WorkflowEnvironment.StartTimeSkippingAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        using var worker = NewWorker(env.Client, tq, "region-a");
        await worker.ExecuteAsync(async () =>
        {
            var handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t2", "alice", "bob", 10m, PauseSeconds: 30)),
                new(id: $"transfer-{Guid.NewGuid()}", taskQueue: tq));
            await handle.GetResultAsync();

            var events = (await handle.FetchHistoryAsync()).Events.ToList();
            var order = events
                .Where(e => e.EventType is EventType.ActivityTaskCompleted or EventType.TimerStarted)
                .Select(e => e.EventType)
                .ToList();
            Assert.Equal(new[] { EventType.ActivityTaskCompleted, EventType.TimerStarted, EventType.ActivityTaskCompleted }, order);

            var timer = events.Single(e => e.EventType == EventType.TimerStarted);
            Assert.Equal(TimeSpan.FromSeconds(30), timer.TimerStartedEventAttributes.StartToFireTimeout.ToTimeSpan());
        });
    }

    [Theory]
    [InlineData(0, "alice", "bob")]
    [InlineData(-5, "alice", "bob")]
    [InlineData(10, "alice", "alice")]
    public async Task Invalid_transfer_fails_without_withdraw(decimal amount, string from, string to)
    {
        await using var env = await WorkflowEnvironment.StartTimeSkippingAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        var bank = new Bank();
        using var worker = NewWorker(env.Client, tq, "region-a", bank);
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
            Assert.Equal(Bank.StartingBalance, bank.Balance(from));
        });
    }
}
