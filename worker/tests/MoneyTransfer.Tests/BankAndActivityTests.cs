using MoneyTransfer.Core;
using Temporalio.Exceptions;
using Temporalio.Testing;
using Xunit;

namespace MoneyTransfer.Tests;

public class BankAndActivityTests
{
    [Fact]
    public void Same_key_applies_once()
    {
        var bank = new Bank();
        Assert.True(bank.Apply("t1-withdraw", "alice", -100m));
        Assert.False(bank.Apply("t1-withdraw", "alice", -100m));
        Assert.Equal(Bank.StartingBalance - 100m, bank.Balance("alice"));
    }

    [Fact]
    public async Task Retried_withdraw_and_deposit_change_balances_once()
    {
        var bank = new Bank();
        var activities = new TransferActivities(bank, "region-a");
        var env = new ActivityEnvironment();

        for (var attempt = 0; attempt < 3; attempt++)
        {
            await env.RunAsync(() => activities.Withdraw(new StepInput("t1", "alice", 40m)));
            await env.RunAsync(() => activities.Deposit(new StepInput("t1", "bob", 40m)));
        }

        Assert.Equal(Bank.StartingBalance - 40m, bank.Balance("alice"));
        Assert.Equal(Bank.StartingBalance + 40m, bank.Balance("bob"));
    }

    [Fact]
    public async Task Step_reports_region_and_whether_applied()
    {
        var activities = new TransferActivities(new Bank(), "gcp-us-east4");
        var env = new ActivityEnvironment();

        var first = await env.RunAsync(() => activities.Withdraw(new StepInput("t9", "alice", 1m)));
        var retry = await env.RunAsync(() => activities.Withdraw(new StepInput("t9", "alice", 1m)));

        Assert.Equal("gcp-us-east4", first.Region);
        Assert.True(first.Applied);
        Assert.False(retry.Applied);
    }

    [Fact]
    public async Task Insufficient_funds_is_non_retryable()
    {
        var activities = new TransferActivities(new Bank(), "region-a");
        var env = new ActivityEnvironment();

        var ex = await Assert.ThrowsAsync<ApplicationFailureException>(() =>
            env.RunAsync(() => activities.Withdraw(new StepInput("t5", "alice", Bank.StartingBalance + 1))));
        Assert.True(ex.NonRetryable);
        Assert.Equal("InsufficientFunds", ex.ErrorType);
    }
}
