using Temporalio.Activities;
using Temporalio.Exceptions;

namespace MoneyTransfer.Core;

public class TransferActivities(Bank bank, string region)
{
    public string Region { get; } = region;

    [Activity(Names.Withdraw)]
    public StepResult Withdraw(StepInput input) =>
        Run(Names.Withdraw, input, -input.Amount);

    [Activity(Names.Deposit)]
    public StepResult Deposit(StepInput input) =>
        Run(Names.Deposit, input, input.Amount);

    private StepResult Run(string step, StepInput input, decimal delta)
    {
        bool applied;
        try
        {
            applied = bank.Apply($"{input.TransferId}-{step.ToLowerInvariant()}", input.Account, delta);
        }
        catch (InsufficientFundsException e)
        {
            throw new ApplicationFailureException(e.Message, errorType: "InsufficientFunds", nonRetryable: true);
        }

        if (ActivityExecutionContext.HasCurrent)
        {
            ActivityExecutionContext.Current.MetricMeter
                .CreateCounter<long>("transfer_steps", description: "Transfer steps executed")
                .Add(1, new Dictionary<string, object> { ["step"] = step.ToLowerInvariant() });
        }

        return new StepResult(step, Region, applied);
    }
}
