// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "contracts/multiRewards/interfaces/IMultiRewardsBasePool.sol";
import "contracts/interfaces/ITimeLockPool.sol";

import "contracts/multiRewards/base/AbstractMultiRewards.sol";
import "contracts/base/TokenSaver.sol";

abstract contract MultiRewardsBasePoolV2 is
    ERC20Votes,
    AbstractMultiRewards,
    IMultiRewardsBasePool,
    TokenSaver,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC20 public immutable depositToken;

    address[] public rewardTokens;
    mapping(address => bool) public rewardTokensList;
    mapping(address => address) public escrowPools;
    mapping(address => uint256) public escrowPortions; // how much is escrowed 1e18 == 100%
    mapping(address => uint256) public escrowDurations; // escrow duration in seconds

    event RewardsClaimed(
        address indexed _reward,
        address indexed _from,
        address indexed _receiver,
        uint256 _escrowedAmount,
        uint256 _nonEscrowedAmount
    );
    event EscrowPoolUpdated(address indexed _reward, address _escrowPool);
    event EscrowPortionUpdated(address indexed _reward, uint256 _portion);
    event EscrowDurationUpdated(address indexed _reward, uint256 _duration);

    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken,
        address[] memory _rewardTokens,
        address[] memory _escrowPools,
        uint256[] memory _escrowPortions,
        uint256[] memory _escrowDurations
    ) ERC20Permit(_name) ERC20(_name, _symbol) AbstractMultiRewards(balanceOf, totalSupply) {
        require(_depositToken != address(0), "MultiRewardsBasePoolV2.constructor: Deposit token must be set");
        require(
            _rewardTokens.length == _escrowPools.length,
            "MultiRewardsBasePoolV2.constructor: reward tokens and escrow pools length mismatch"
        );
        require(
            _rewardTokens.length == _escrowPortions.length,
            "MultiRewardsBasePoolV2.constructor: reward tokens and escrow portions length mismatch"
        );
        require(
            _rewardTokens.length == _escrowDurations.length,
            "MultiRewardsBasePoolV2.constructor: reward tokens and escrow durations length mismatch"
        );

        depositToken = IERC20(_depositToken);

        for (uint256 i = 0; i < _rewardTokens.length; i++) {
            address rewardToken = _rewardTokens[i];
            require(
                rewardToken != address(0),
                "MultiRewardsBasePoolV2.constructor: reward token cannot be zero address"
            );

            address escrowPool = _escrowPools[i];

            uint256 escrowPortion = _escrowPortions[i];
            require(escrowPortion <= 1e18, "MultiRewardsBasePoolV2.constructor: Cannot escrow more than 100%");

            uint256 escrowDuration = _escrowDurations[i];

            if (!rewardTokensList[rewardToken]) {
                rewardTokensList[rewardToken] = true;
                rewardTokens.push(rewardToken);
                escrowPools[rewardToken] = escrowPool;
                escrowPortions[rewardToken] = escrowPortion;
                escrowDurations[rewardToken] = escrowDuration;

                if (escrowPool != address(0)) {
                    IERC20(rewardToken).safeApprove(escrowPool, type(uint256).max);
                }
            }
        }

        _setupRole(ADMIN_ROLE, msg.sender);
    }

    /// @dev A modifier which checks that the caller has the admin role.
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "MultiRewardsBasePoolV2: only admin");
        _;
    }

    function _mint(address _account, uint256 _amount) internal virtual override {
        super._mint(_account, _amount);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address reward = rewardTokens[i];
            _correctPoints(reward, _account, -(_amount.toInt256()));
        }
    }

    function _burn(address _account, uint256 _amount) internal virtual override {
        super._burn(_account, _amount);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address reward = rewardTokens[i];
            _correctPoints(reward, _account, _amount.toInt256());
        }
    }

    function _transfer(
        address _from,
        address _to,
        uint256 _value
    ) internal virtual override {
        super._transfer(_from, _to, _value);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address reward = rewardTokens[i];
            _correctPointsForTransfer(reward, _from, _to, _value);
        }
    }

    function rewardTokensLength() external view returns (uint256) {
        return rewardTokens.length;
    }

    function addRewardToken(
        address _reward,
        address _escrowPool,
        uint256 _escrowPortion,
        uint256 _escrowDuration
    ) external onlyAdmin {
        require(_reward != address(0), "MultiRewardsBasePoolV2.addRewardToken: reward token cannot be zero address");
        require(_escrowPortion <= 1e18, "MultiRewardsBasePoolV2.addRewardToken: Cannot escrow more than 100%");

        if (!rewardTokensList[_reward]) {
            rewardTokensList[_reward] = true;
            rewardTokens.push(_reward);
            escrowPools[_reward] = _escrowPool;
            escrowPortions[_reward] = _escrowPortion;
            escrowDurations[_reward] = _escrowDuration;

            if (_reward != address(0) && _escrowPool != address(0)) {
                IERC20(_reward).safeApprove(_escrowPool, type(uint256).max);
            }
        }
    }

    function updateRewardToken(
        address _reward,
        address _escrowPool,
        uint256 _escrowPortion,
        uint256 _escrowDuration
    ) external onlyAdmin {
        require(rewardTokensList[_reward], "MultiRewardsBasePoolV2.updateRewardToken: reward token not in the list");
        require(_reward != address(0), "MultiRewardsBasePoolV2.updateRewardToken: reward token cannot be zero address");
        require(_escrowPortion <= 1e18, "MultiRewardsBasePoolV2.updateRewardToken: Cannot escrow more than 100%");

        if (escrowPools[_reward] != _escrowPool && _escrowPool != address(0)) {
            IERC20(_reward).safeApprove(_escrowPool, type(uint256).max);
        }
        escrowPools[_reward] = _escrowPool;
        escrowPortions[_reward] = _escrowPortion;
        escrowDurations[_reward] = _escrowDuration;
    }

    function distributeRewards(address _reward, uint256 _amount) external override nonReentrant {
        require(rewardTokensList[_reward], "MultiRewardsBasePoolV2.distributeRewards: reward token not in the list");
        IERC20(_reward).safeTransferFrom(_msgSender(), address(this), _amount);
        _distributeRewards(_reward, _amount);
    }

    function claimRewards(address _reward, address _receiver) public {
        require(rewardTokensList[_reward], "MultiRewardsBasePoolV2.claimRewards: reward token not in the list");

        uint256 rewardAmount = _prepareCollect(_reward, _msgSender());
        uint256 escrowedRewardAmount = (rewardAmount * escrowPortions[_reward]) / 1e18;
        uint256 nonEscrowedRewardAmount = rewardAmount - escrowedRewardAmount;

        ITimeLockPool escrowPool = ITimeLockPool(escrowPools[_reward]);
        if (escrowedRewardAmount != 0 && address(escrowPool) != address(0)) {
            escrowPool.deposit(escrowedRewardAmount, escrowDurations[_reward], _receiver);
        }

        // ignore dust
        if (nonEscrowedRewardAmount > 1) {
            IERC20(_reward).safeTransfer(_receiver, nonEscrowedRewardAmount);
        }

        emit RewardsClaimed(_reward, _msgSender(), _receiver, escrowedRewardAmount, nonEscrowedRewardAmount);
    }

    function claimAll(address _receiver) external {
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address reward = rewardTokens[i];
            claimRewards(reward, _receiver);
        }
    }

    function updateEscrowPool(address _targetRewardToken, address _newEscrowPool) external onlyAdmin {
        require(_newEscrowPool != address(0), "MultiRewardsBasePoolV2.updateEscrowPool: escrowPool must be set");
        require(
            rewardTokensList[_targetRewardToken],
            "MultiRewardsBasePoolV2.updateEscrowPool: reward token not in the list"
        );

        address oldEscrowPool = escrowPools[_targetRewardToken];

        escrowPools[_targetRewardToken] = _newEscrowPool;
        if (_targetRewardToken != address(0) && _newEscrowPool != address(0)) {
            IERC20(_targetRewardToken).safeApprove(oldEscrowPool, 0);
            IERC20(_targetRewardToken).safeApprove(_newEscrowPool, type(uint256).max);
        }

        emit EscrowPoolUpdated(_targetRewardToken, _newEscrowPool);
    }

    function updateEscrowPortion(address _targetRewardToken, uint256 _newEscrowPortion) external onlyAdmin {
        // how much is escrowed 1e18 == 100%
        require(
            rewardTokensList[_targetRewardToken],
            "MultiRewardsBasePoolV2.updateEscrowPortion: reward token not in the list"
        );
        require(_newEscrowPortion <= 1e18, "MultiRewardsBasePoolV2.updateEscrowPortion: cannot escrow more than 100%");

        escrowPortions[_targetRewardToken] = _newEscrowPortion;

        emit EscrowPortionUpdated(_targetRewardToken, _newEscrowPortion);
    }

    function updateEscrowDuration(address _targetRewardToken, uint256 _newDuration) external onlyAdmin {
        // escrow duration in seconds
        require(
            rewardTokensList[_targetRewardToken],
            "MultiRewardsBasePoolV2.updateEscrowDuration: reward token not in the list"
        );

        escrowDurations[_targetRewardToken] = _newDuration;

        emit EscrowDurationUpdated(_targetRewardToken, _newDuration);
    }
}
