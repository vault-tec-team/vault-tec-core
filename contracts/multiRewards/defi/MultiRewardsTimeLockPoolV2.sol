// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/multiRewards/defi/base/MultiRewardsBasePoolV2.sol";
import "contracts/interfaces/ITimeLockPool.sol";

contract MultiRewardsTimeLockPoolV2 is MultiRewardsBasePoolV2, ITimeLockPool {
    using Math for uint256;
    using SafeERC20 for IERC20;

    uint256 public immutable maxBonus;
    uint256 public immutable minLockDuration;
    uint256 public immutable maxLockDuration;
    uint256 public constant MIN_LOCK_DURATION_FOR_SAFETY = 10 minutes;
    uint256 public gracePeriod = 7 days;
    uint256 public kickRewardIncentive = 100;
    uint256 public constant DENOMINATOR = 10000;

    mapping(address => Deposit[]) public depositsOf;

    event GracePeriodUpdated(uint256 _gracePeriod);
    event KickRewardIncentiveUpdated(uint256 _kickRewardIncentive);

    struct Deposit {
        uint256 amount;
        uint64 start;
        uint64 end;
    }
    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken,
        address[] memory _rewardTokens,
        address[] memory _escrowPools,
        uint256[] memory _escrowPortions,
        uint256[] memory _escrowDurations,
        uint256 _maxBonus,
        uint256 _minLockDuration,
        uint256 _maxLockDuration
    ) MultiRewardsBasePoolV2(_name, _symbol, _depositToken, _rewardTokens, _escrowPools, _escrowPortions, _escrowDurations) {
        require(
            _minLockDuration >= MIN_LOCK_DURATION_FOR_SAFETY, 
            "MultiRewardsTimeLockPoolV2.constructor: min lock duration must be greater or equal to mininmum lock duration for safety"
        );
        require(
            _maxLockDuration >= _minLockDuration, 
            "MultiRewardsTimeLockPoolV2.constructor: max lock duration must be greater or equal to mininmum lock duration"
        );
        maxBonus = _maxBonus;
        minLockDuration = _minLockDuration;
        maxLockDuration = _maxLockDuration;
    }

    event Deposited(uint256 amount, uint256 duration, address indexed receiver, address indexed from);
    event Withdrawn(uint256 indexed depositId, address indexed receiver, address indexed from, uint256 amount);

    function deposit(uint256 _amount, uint256 _duration, address _receiver) external override nonReentrant {
        _deposit(_msgSender(), _amount, _duration, _receiver, false);
    }

    function batchDeposit(
        uint256[] memory _amounts, 
        uint256[] memory _durations, 
        address[] memory _receivers) external nonReentrant {
        require(_amounts.length == _durations.length, 
            "MultiRewardsTimeLockPoolV2.batchDeposit: amounts and durations length mismatch");
        require(_amounts.length == _receivers.length, 
            "MultiRewardsTimeLockPoolV2.batchDeposit: amounts and receivers length mismatch");

        for (uint256 i = 0; i < _receivers.length; i++){
            _deposit(_msgSender(), _amounts[i],_durations[i],_receivers[i], false);
        }
    }

    function _deposit(address _depositor, uint256 _amount, uint256 _duration, address _receiver, bool relock) internal {
        require(_depositor != address(0), "MultiRewardsTimeLockPoolV2._deposit: depositor cannot be zero address");
        require(_receiver != address(0), "MultiRewardsTimeLockPoolV2._deposit: receiver cannot be zero address");
        require(_amount > 0, "MultiRewardsTimeLockPoolV2._deposit: cannot deposit 0");
        // Don't allow locking > maxLockDuration
        uint256 duration = _duration.min(maxLockDuration);
        // Enforce min lockup duration to prevent flash loan or MEV transaction ordering
        duration = duration.max(minLockDuration);

        if (!relock) {
            depositToken.safeTransferFrom(_depositor, address(this), _amount);
        }

        depositsOf[_receiver].push(Deposit({
            amount: _amount,
            start: uint64(block.timestamp),
            end: uint64(block.timestamp) + uint64(duration)
        }));

        uint256 mintAmount = _amount * getMultiplier(duration) / 1e18;

        _mint(_receiver, mintAmount);
        emit Deposited(_amount, duration, _receiver, _depositor);
    }

    function withdraw(uint256 _depositId, address _receiver) external nonReentrant {
        require(_receiver != address(0), "MultiRewardsTimeLockPoolV2.withdraw: receiver cannot be zero address");
        require(_depositId < depositsOf[_msgSender()].length, "MultiRewardsTimeLockPoolV2.withdraw: Deposit does not exist");
        Deposit memory userDeposit = depositsOf[_msgSender()][_depositId];
        require(block.timestamp >= userDeposit.end, "MultiRewardsTimeLockPoolV2.withdraw: too soon");

        // No risk of wrapping around on casting to uint256 since deposit end always > deposit start and types are 64 bits
        uint256 shareAmount = userDeposit.amount * getMultiplier(uint256(userDeposit.end - userDeposit.start)) / 1e18;

        // remove Deposit
        depositsOf[_msgSender()][_depositId] = depositsOf[_msgSender()][depositsOf[_msgSender()].length - 1];
        depositsOf[_msgSender()].pop();

        // burn pool shares
        _burn(_msgSender(), shareAmount);
        
        // return tokens
        depositToken.safeTransfer(_receiver, userDeposit.amount);
        emit Withdrawn(_depositId, _receiver, _msgSender(), userDeposit.amount);
    }

    function kickExpiredDeposit(address _account, uint256 _depositId) external nonReentrant {
        _processExpiredDeposit(_account, _depositId, false, 0);
    }

    function processExpiredLock(uint256 _depositId, uint256 _duration) external nonReentrant {
        _processExpiredDeposit(msg.sender, _depositId, true, _duration);
    }

    function _processExpiredDeposit(address _account, uint256 _depositId, bool relock, uint256 _duration) internal {
        require(_account != address(0), "MultiRewardsTimeLockPoolV2._processExpiredDeposit: account cannot be zero address");
        require(_depositId < depositsOf[_account].length, "MultiRewardsTimeLockPoolV2._processExpiredDeposit: deposit does not exist");
        Deposit memory userDeposit = depositsOf[_account][_depositId];
        require(block.timestamp >= userDeposit.end, "MultiRewardsTimeLockPoolV2._processExpiredDeposit: too soon");

        uint256 returnAmount = userDeposit.amount;
        uint256 reward = 0;
        if (block.timestamp >= userDeposit.end + gracePeriod) {
            //penalty
            reward = userDeposit.amount * kickRewardIncentive / DENOMINATOR;
            returnAmount -= reward;
        }

        uint256 shareAmount = userDeposit.amount * getMultiplier(uint256(userDeposit.end - userDeposit.start)) / 1e18;

        // remove Deposit
        depositsOf[_account][_depositId] = depositsOf[_account][depositsOf[_account].length - 1];
        depositsOf[_account].pop();

        // burn pool shares
        _burn(_account, shareAmount);

        if (relock) {
            _deposit(_msgSender(), returnAmount, _duration, _account, true);
        } else {
            depositToken.safeTransfer(_account, returnAmount);
        }

        if (reward > 0) {
            depositToken.safeTransfer(msg.sender, reward);
        }
    }

    function getMultiplier(uint256 _lockDuration) public view returns(uint256) {
        return 1e18 + (maxBonus * _lockDuration / maxLockDuration);
    }

    function getTotalDeposit(address _account) public view returns(uint256) {
        uint256 total;
        for(uint256 i = 0; i < depositsOf[_account].length; i++) {
            total += depositsOf[_account][i].amount;
        }

        return total;
    }

    function getDepositsOf(address _account) public view returns(Deposit[] memory) {
        return depositsOf[_account];
    }

    function getDepositsOfLength(address _account) public view returns(uint256) {
        return depositsOf[_account].length;
    }

    function updateGracePeriod(uint256 _gracePeriod) external onlyAdmin {
        gracePeriod = _gracePeriod;
        emit GracePeriodUpdated(_gracePeriod);
    }

    function updateKickRewardIncentive(uint256 _kickRewardIncentive) external onlyAdmin {
        require(
            _kickRewardIncentive <= DENOMINATOR,
            "MultiRewardsTimeLockPoolV2.updateKickRewardIncentive: kick reward incentive cannot be greater than 100%"
        );
        kickRewardIncentive = _kickRewardIncentive;
        emit KickRewardIncentiveUpdated(_kickRewardIncentive);
    }
}