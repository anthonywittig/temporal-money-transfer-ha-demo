using MoneyTransfer.Core;
using Temporalio.Api.Enums.V1;
using Temporalio.Client;
using Temporalio.Testing;
using Temporalio.Worker;
using Xunit;

using static MoneyTransfer.Tests.Helpers;

namespace MoneyTransfer.Tests;

/// <summary>
/// Simulates a failover locally: a worker in "region A" runs the withdraw step and is stopped
/// mid-pause; a fresh worker in "region B" (new process state, new bank) replays the history and
/// finishes the deposit.
/// </summary>
public class FailoverReplayTests
{
    [Fact]
    public async Task Fresh_worker_in_other_region_finishes_in_flight_transfer()
    {
        await using var env = await StartEnvAsync();
        var tq = $"tq-{Guid.NewGuid()}";
        var id = $"transfer-{Guid.NewGuid()}";
        WorkflowHandle<MoneyTransferWorkflow, TransferResult> handle;

        // Region A: run until the withdraw has completed, then stop the worker.
        using (var workerA = new TemporalWorker(env.Client, new TemporalWorkerOptions(tq)
                   .AddWorkflow<MoneyTransferWorkflow>()
                   .AddAllActivities(new TransferActivities("region-a"))))
        {
            using var stopA = new CancellationTokenSource();
            var runA = workerA.ExecuteAsync(stopA.Token);

            handle = await env.Client.StartWorkflowAsync(
                RunWith(new TransferInput("t-failover", "alice", "bob", 5m)),
                new(id: id, taskQueue: tq));

            // The timer is the pause between withdraw and deposit.
            await WaitForAsync(async () =>
                (await handle.FetchHistoryAsync()).Events.Any(e => e.EventType == EventType.TimerStarted));

            stopA.Cancel();
            try { await runA; } catch (OperationCanceledException) { }
        }

        // The partial history replays cleanly on fresh workflow code.
        var history = await handle.FetchHistoryAsync();
        var replay = await new WorkflowReplayer(new WorkflowReplayerOptions().AddWorkflow<MoneyTransferWorkflow>())
            .ReplayWorkflowAsync(history, throwOnReplayFailure: false);
        Assert.Null(replay.ReplayFailure);

        // Region B: a fresh worker (no sticky cache, new bank) completes the transfer.
        using var workerB = new TemporalWorker(env.Client, new TemporalWorkerOptions(tq)
            .AddWorkflow<MoneyTransferWorkflow>()
            .AddAllActivities(new TransferActivities("region-b")));
        var result = await workerB.ExecuteAsync(() => handle.GetResultAsync());

        Assert.Equal("region-a", result.Withdraw.Region);
        Assert.Equal("region-b", result.Deposit.Region);

        var attrs = (await handle.DescribeAsync()).TypedSearchAttributes;
        Assert.Equal("region-a", attrs.Get(TransferSearchAttributes.WithdrawRegion));
        Assert.Equal("region-b", attrs.Get(TransferSearchAttributes.DepositRegion));
        Assert.True(attrs.Get(TransferSearchAttributes.CrossRegion));

        var events = (await handle.FetchHistoryAsync()).Events;
        Assert.Equal(2, events.Count(e => e.EventType == EventType.ActivityTaskCompleted));
        Assert.Equal(1, events.Count(e => e.EventType == EventType.WorkflowExecutionCompleted));
    }

    private static async Task WaitForAsync(Func<Task<bool>> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!await condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("condition not met");
            await Task.Delay(100);
        }
    }
}
