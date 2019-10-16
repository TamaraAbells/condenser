import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Slider from 'react-rangeslider';
import tt from 'counterpart';
import CloseButton from 'app/components/elements/CloseButton';
import * as transactionActions from 'app/redux/TransactionReducer';
import Icon from 'app/components/elements/Icon';
import {
    DEBT_TOKEN_SHORT,
    LIQUID_TOKEN_UPPERCASE,
    INVEST_TOKEN_SHORT,
} from 'app/client_config';
import FormattedAsset from 'app/components/elements/FormattedAsset';
import { pricePerSteem } from 'app/utils/StateFunctions';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import {
    formatDecimal,
    parsePayoutAmount,
} from 'app/utils/ParsersAndFormatters';
import DropdownMenu from 'app/components/elements/DropdownMenu';
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import Dropdown from 'app/components/elements/Dropdown';

const ABOUT_FLAG = (
    <div>
        <p>
            Downvoting a post can decrease pending rewards and make it less
            visible. Common reasons:
        </p>
        <ul>
            <li>Disagreement on rewards</li>
            <li>Fraud or plagiarism</li>
            <li>Hate speech or trolling</li>
            <li>Miscategorized content or spam</li>
        </ul>
    </div>
);

const MAX_VOTES_DISPLAY = 20;
const VOTE_WEIGHT_DROPDOWN_THRESHOLD = 0; //1.0 * 1000.0 * 1000.0;
const SBD_PRINT_RATE_MAX = 10000;
const MAX_WEIGHT = 10000;
const MIN_PAYOUT = 0.02;

function amt(string_amount) {
    return parsePayoutAmount(string_amount);
}

function fmt(decimal_amount, asset = null) {
    return formatDecimal(decimal_amount).join('') + (asset ? ' ' + asset : '');
}

function abs(value) {
    return Math.abs(parseInt(value));
}

function effectiveVests(account) {
    const vests = account ? account.get('vesting_shares') : 0.0;
    const delegated = account ? account.get('delegated_vesting_shares') : 0.0;
    const received = account ? account.get('received_vesting_shares') : 0.0;
    return vests - delegated + received;
}

class Voting extends React.Component {
    static propTypes = {
        // HTML properties
        showList: PropTypes.bool,

        // Redux connect properties
        vote: PropTypes.func.isRequired,
        author: PropTypes.string, // post was deleted
        permlink: PropTypes.string,
        username: PropTypes.string,
        is_comment: PropTypes.bool,
        active_votes: PropTypes.object,
        post: PropTypes.object,
        enable_slider: PropTypes.bool,
        voting: PropTypes.bool,
        price_per_steem: PropTypes.number,
        sbd_print_rate: PropTypes.number,
    };

    static defaultProps = {
        showList: true,
    };

    constructor(props) {
        super(props);
        this.state = {
            showWeight: null,
            myVote: null,
            sliderWeight: {
                up: MAX_WEIGHT,
                down: MAX_WEIGHT,
            },
        };

        this.voteUp = e => {
            e && e.preventDefault();
            this.voteUpOrDown(true);
        };
        this.voteDown = e => {
            e && e.preventDefault();
            this.voteUpOrDown(false);
        };
        this.voteUpOrDown = up => {
            if (this.props.voting) return;
            this.setState({ votingUp: up, votingDown: !up });
            if (this.state.showWeight) this.setState({ showWeight: null });

            const { myVote } = this.state;
            const { author, permlink, username, is_comment } = this.props;

            let weight;
            if (myVote > 0 || myVote < 0) {
                // if there is a current vote, we're clearing it
                weight = 0;
            } else if (this.props.enable_slider) {
                // if slider is enabled, read its value
                weight = up
                    ? this.state.sliderWeight.up
                    : -this.state.sliderWeight.down;
            } else {
                // otherwise, use max power
                weight = up ? MAX_WEIGHT : -MAX_WEIGHT;
            }

            const isFlag = up ? null : true;
            this.props.vote(weight, {
                author,
                permlink,
                username,
                myVote,
                isFlag,
            });
        };

        this.handleWeightChange = up => weight => {
            let w;
            if (up) {
                w = {
                    up: weight,
                    down: this.state.sliderWeight.down,
                };
            } else {
                w = {
                    up: this.state.sliderWeight.up,
                    down: weight,
                };
            }
            this.setState({ sliderWeight: w });
        };

        this.storeSliderWeight = up => () => {
            const { username, is_comment } = this.props;
            const weight = up
                ? this.state.sliderWeight.up
                : this.state.sliderWeight.down;
            localStorage.setItem(
                'voteWeight' +
                    (up ? '' : 'Down') +
                    '-' +
                    username +
                    (is_comment ? '-comment' : ''),
                weight
            );
        };
        this.readSliderWeight = () => {
            const { username, enable_slider, is_comment } = this.props;
            if (enable_slider) {
                const sliderWeightUp = Number(
                    localStorage.getItem(
                        'voteWeight' +
                            '-' +
                            username +
                            (is_comment ? '-comment' : '')
                    )
                );
                const sliderWeightDown = Number(
                    localStorage.getItem(
                        'voteWeight' +
                            'Down' +
                            '-' +
                            username +
                            (is_comment ? '-comment' : '')
                    )
                );
                this.setState({
                    sliderWeight: {
                        up: sliderWeightUp ? sliderWeightUp : MAX_WEIGHT,
                        down: sliderWeightDown ? sliderWeightDown : MAX_WEIGHT,
                    },
                });
            }
        };

        this.toggleWeightUp = e => {
            e.preventDefault();
            const { showWeight } = this.state;
            this.setState({ showWeight: showWeight === 'up' ? null : 'up' });
        };

        this.toggleWeightDown = e => {
            e.preventDefault();
            const { showWeight } = this.state;
            this.setState({
                showWeight: showWeight === 'down' ? null : 'down',
            });
        };

        //this.shouldComponentUpdate = shouldComponentUpdate(this, 'Voting');
    }

    componentWillMount() {
        const { username, active_votes } = this.props;
        this._checkMyVote(username, active_votes);
    }

    componentWillReceiveProps(nextProps) {
        const { username, active_votes } = nextProps;
        this._checkMyVote(username, active_votes);
    }

    _checkMyVote(username, active_votes) {
        if (!username || !active_votes) return;
        const vote = active_votes.find(el => el.get('voter') === username);
        // weight warning, the API may send a string or a number (when zero)
        if (vote)
            this.setState({ myVote: parseInt(vote.get('percent') || 0, 10) });
    }

    render() {
        const {
            active_votes,
            showList,
            voting,
            enable_slider,
            is_comment,
            post,
            price_per_steem,
            sbd_print_rate,
            username,
        } = this.props;

        const { votingUp, votingDown, showWeight, myVote } = this.state;

        const votingUpActive = voting && votingUp;
        const votingDownActive = voting && votingDown;
        const emptyVote = myVote === null || myVote === 0;

        const slider = up => {
            const b = up
                ? this.state.sliderWeight.up
                : this.state.sliderWeight.down;
            const s = up ? '' : '-';
            return (
                <span>
                    <div className="weight-display">{s + b / 100}%</div>
                    <Slider
                        min={100}
                        max={MAX_WEIGHT}
                        step={100}
                        value={b}
                        onChange={this.handleWeightChange(up)}
                        onChangeComplete={this.storeSliderWeight(up)}
                        tooltip={false}
                    />
                </span>
            );
        };

        // -- downvote --

        let downvoteEl = (
            <span
                onClick={emptyVote ? this.toggleWeightDown : this.voteDown}
                title="Downvote"
                id="downvote_button"
                className="flag"
            >
                <Icon
                    name={votingDownActive ? 'empty' : 'chevron-down-circle'}
                    className="flag"
                />
            </span>
        );

        if (emptyVote) {
            downvoteEl = (
                <Dropdown
                    show={showWeight == 'down'}
                    onHide={() => {
                        this.setState({ showWeight: null });
                    }}
                    onShow={() => {
                        this.setState({ showWeight: 'down' });
                        this.readSliderWeight();
                    }}
                    title={downvoteEl}
                    position={'right'}
                >
                    <div className="Voting__adjust_weight_down">
                        {emptyVote &&
                            enable_slider && (
                                <div className="weight-container">
                                    {slider(false)}
                                </div>
                            )}
                        <CloseButton
                            onClick={() => this.setState({ showWeight: null })}
                        />
                        <div className="clear Voting__about-flag">
                            {ABOUT_FLAG}
                            <br />
                            <span
                                href="#"
                                onClick={this.voteDown}
                                className="button outline"
                                title="Downvote"
                            >
                                Submit
                            </span>
                        </div>
                    </div>
                </Dropdown>
            );
        }

        const classDown =
            'Voting__button Voting__button-down' +
            (myVote < 0 ? ' Voting__button--downvoted' : '') +
            (votingDownActive ? ' votingDown' : '');
        const downVote = <span className={classDown}>{downvoteEl}</span>;

        // -- end downvote --

        // payout meta
        const total_votes = post.getIn(['stats', 'total_votes']);
        const payout_at = post.get('payout_at');
        const promoted = amt(post.get('promoted'));
        const max_payout = amt(post.get('max_accepted_payout'));
        const percent_sbd = post.get('percent_steem_dollars') / 20000;

        // pending payout, and completed author/curator payout
        const pending_payout = amt(post.get('pending_payout_value'));
        const author_payout = amt(post.get('total_payout_value'));
        const curator_payout = amt(post.get('curator_payout_value'));
        const total_payout = pending_payout + author_payout + curator_payout;

        // estimated pending payout breakdowns
        const _sbd = pending_payout * percent_sbd;
        const pending_sp = (pending_payout - _sbd) / price_per_steem;
        const pending_sbd = _sbd * (sbd_print_rate / SBD_PRINT_RATE_MAX);
        const pending_steem = (_sbd - pending_sbd) / price_per_steem;

        const payoutItems = [];

        // pending payout info
        if (!post.get('is_paidout') && pending_payout > 0) {
            payoutItems.push({
                value: tt('voting_jsx.pending_payout', {
                    value: fmt(pending_payout),
                }),
            });

            // pending breakdown
            if (max_payout > 0) {
                payoutItems.push({
                    value:
                        tt('voting_jsx.breakdown') +
                        ': ' +
                        (fmt(pending_sbd, DEBT_TOKEN_SHORT) + ', ') +
                        (sbd_print_rate != SBD_PRINT_RATE_MAX
                            ? fmt(pending_steem, LIQUID_TOKEN_UPPERCASE) + ', '
                            : '') +
                        fmt(pending_sp, INVEST_TOKEN_SHORT),
                });
            }

            const beneficiaries = post.get('beneficiaries');
            if (beneficiaries) {
                beneficiaries.forEach(function(key) {
                    payoutItems.push({
                        value:
                            key.get('account') +
                            ': ' +
                            (fmt(parseFloat(key.get('weight')) / 100) + '%'),
                        link: '/@' + key.get('account'),
                    });
                });
            }

            const payoutDate = (
                <span>
                    {tt('voting_jsx.payout')}{' '}
                    <TimeAgoWrapper date={payout_at} />
                </span>
            );
            payoutItems.push({ value: payoutDate });

            if (pending_payout > 0 && pending_payout < MIN_PAYOUT) {
                payoutItems.push({
                    value: tt('voting_jsx.must_reached_minimum_payout'),
                });
            }
        }

        // max payout / payout declined
        if (max_payout == 0) {
            payoutItems.push({ value: tt('voting_jsx.payout_declined') });
        } else if (max_payout < 1000000) {
            payoutItems.push({
                value: tt('voting_jsx.max_accepted_payout', {
                    value: fmt(max_payout),
                }),
            });
        }

        // promoted balance
        if (promoted > 0) {
            payoutItems.push({
                value: tt('voting_jsx.promotion_cost', {
                    value: fmt(promoted),
                }),
            });
        }

        // past payout stats
        if (post.get('is_paidout') && total_payout > 0) {
            payoutItems.push({
                value: tt('voting_jsx.past_payouts', {
                    value: fmt(total_payout),
                }),
            });
            payoutItems.push({
                value: tt('voting_jsx.past_payouts_author', {
                    value: fmt(author_payout),
                }),
            });
            payoutItems.push({
                value: tt('voting_jsx.past_payouts_curators', {
                    value: fmt(curator_payout),
                }),
            });
        }

        const _limit_hit = max_payout > 0 && total_payout >= max_payout;
        const payoutEl = (
            <DropdownMenu el="div" items={payoutItems}>
                <span style={_limit_hit ? { opacity: '0.5' } : {}}>
                    <FormattedAsset
                        amount={_limit_hit ? max_payout : total_payout}
                        asset="$"
                        classname={max_payout === 0 ? 'strikethrough' : ''}
                    />
                    {payoutItems.length > 0 && <Icon name="dropdown-arrow" />}
                </span>
            </DropdownMenu>
        );

        let voters_list = null;
        if (showList && total_votes > 0 && active_votes) {
            const avotes = active_votes.toJS();
            avotes.sort((a, b) => (abs(a.rshares) > abs(b.rshares) ? -1 : 1));
            let voters = [];
            for (
                let v = 0;
                v < avotes.length && voters.length < MAX_VOTES_DISPLAY;
                ++v
            ) {
                const { percent, voter } = avotes[v];
                const sign = Math.sign(percent);
                if (sign === 0) continue;
                voters.push({
                    value: (sign > 0 ? '+ ' : '- ') + voter,
                    link: '/@' + voter,
                });
            }
            if (total_votes > voters.length) {
                voters.push({
                    value: (
                        <span>
                            &hellip;{' '}
                            {tt('voting_jsx.and_more', {
                                count: total_votes - voters.length,
                            })}
                        </span>
                    ),
                });
            }
            voters_list = (
                <DropdownMenu
                    selected={tt('voting_jsx.votes_plural', {
                        count: total_votes,
                    })}
                    className="Voting__voters_list"
                    items={voters}
                    el="div"
                />
            );
        }

        // -- upvote --

        const iconUp = (
            <Icon
                name={votingUpActive ? 'empty' : 'chevron-up-circle'}
                className="upvote"
            />
        );

        let upvoteEl = null;
        if (myVote <= 0 && enable_slider) {
            upvoteEl = (
                <Dropdown
                    show={showWeight === 'up'}
                    onHide={() => {
                        this.setState({ showWeight: null });
                    }}
                    onShow={() => {
                        this.setState({ showWeight: 'up' });
                        this.readSliderWeight();
                    }}
                    title={iconUp}
                >
                    <div className="Voting__adjust_weight">
                        <a
                            href="#"
                            onClick={this.voteUp}
                            className="confirm_weight"
                            title={tt('g.upvote')}
                        >
                            <Icon
                                size="2x"
                                name={
                                    votingUpActive
                                        ? 'empty'
                                        : 'chevron-up-circle'
                                }
                            />
                        </a>
                        {slider(true)}
                        <CloseButton
                            className="Voting__adjust_weight_close"
                            onClick={() => this.setState({ showWeight: null })}
                        />
                    </div>
                </Dropdown>
            );
        } else {
            upvoteEl = votingUpActive ? (
                iconUp
            ) : (
                <a
                    href="#"
                    onClick={this.voteUp}
                    title={myVote > 0 ? tt('g.remove_vote') : tt('g.upvote')}
                    id="upvote_button"
                >
                    {iconUp}
                </a>
            );
        }

        const classUp =
            'Voting__button Voting__button-up' +
            (myVote > 0 ? ' Voting__button--upvoted' : '') +
            (votingUpActive ? ' votingUp' : '');

        const upVote = <span className={classUp}>{upvoteEl}</span>;

        // -- end upvote --

        return (
            <span className="Voting">
                <span className="Voting__inner">
                    {upVote}
                    {downVote}
                    {payoutEl}
                </span>
                {voters_list}
            </span>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const postref = ownProps.post;
        const post = state.global.getIn(
            ['content', postref],
            ownProps.post_obj
        );

        if (!post) {
            console.log('props', ownProps);
            throw 'post not found';
        }

        const author = post.get('author');
        const permlink = post.get('permlink');
        const active_votes = post.get('active_votes');
        const is_comment = post.get('parent_author') !== '';

        const current = state.user.get('current');
        const username = current ? current.get('username') : null;
        const net_vests = effectiveVests(current);
        const vote_status_key = `transaction_vote_active_${author}_${permlink}`;
        const voting = state.global.get(vote_status_key);
        const price_per_steem =
            pricePerSteem(state) || ownProps.price_per_steem;
        const sbd_print_rate = state.global.getIn(
            ['props', 'sbd_print_rate'],
            ownProps.sbd_print_rate
        );
        const enable_slider = net_vests > VOTE_WEIGHT_DROPDOWN_THRESHOLD;

        return {
            post,
            showList: ownProps.showList,
            author,
            permlink,
            username,
            active_votes,
            enable_slider,
            is_comment,
            voting,
            price_per_steem,
            sbd_print_rate,
        };
    },

    // mapDispatchToProps
    dispatch => ({
        vote: (weight, { author, permlink, username, myVote, isFlag }) => {
            const confirm = () => {
                if (myVote == null) return null;
                if (weight === 0)
                    return isFlag
                        ? tt('voting_jsx.removing_your_vote')
                        : tt(
                              'voting_jsx.removing_your_vote_will_reset_curation_rewards_for_this_post'
                          );
                if (weight > 0)
                    return isFlag
                        ? tt('voting_jsx.changing_to_an_upvote')
                        : tt(
                              'voting_jsx.changing_to_an_upvote_will_reset_curation_rewards_for_this_post'
                          );
                if (weight < 0)
                    return isFlag
                        ? tt('voting_jsx.changing_to_a_downvote')
                        : tt(
                              'voting_jsx.changing_to_a_downvote_will_reset_curation_rewards_for_this_post'
                          );
                return null;
            };
            dispatch(
                transactionActions.broadcastOperation({
                    type: 'vote',
                    operation: {
                        voter: username,
                        author,
                        permlink,
                        weight,
                        __config: {
                            title: weight < 0 ? 'Confirm Downvote' : null,
                        },
                    },
                    confirm,
                    errorCallback: errorKey => {
                        console.log('Transaction Error:' + errorKey);
                    },
                })
            );
        },
    })
)(Voting);
